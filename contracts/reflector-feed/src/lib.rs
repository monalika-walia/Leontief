//! reflector-feed — a thin shim that lets the fail-closed `oracle-adapter` consume
//! a **live Reflector SEP-40 feed** without touching its core (prompt X1).
//!
//! The adapter's `PriceFeed` trait is `lastprice(asset: Symbol)`; Reflector's is
//! `lastprice(asset: Asset)` where `Asset = Stellar(Address) | Other(Symbol)`. This
//! shim bridges exactly that gap: the adapter calls `lastprice(Symbol)` here, we map
//! the symbol to the Reflector `Asset` registered for it (an `Other(sym)` such as
//! `"XLM"`, or a `Stellar(addr)`), call the real Reflector contract, and pass the
//! XDR-identical `PriceData` straight through — Reflector's 14-dec price is normalized
//! to SCALE by the adapter (configured with `source_decimals = 14`), unchanged here.
//!
//! **Fail-closed by construction:** any Reflector miss (absent price, invocation
//! failure) returns `None`, which the adapter treats as `OracleFailure`. No fallback.
#![no_std]

mod constants;

use constants::{TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, Address, Env, Symbol,
};

/// XDR-identical to Reflector's `Asset` and `PriceData`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// The Reflector read surface we call.
#[contractclient(name = "ReflectorClient")]
pub trait Reflector {
    fn lastprice(e: Env, asset: Asset) -> Option<PriceData>;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    /// The Reflector oracle contract this shim reads.
    Oracle,
    /// Symbol → Reflector `Asset` mapping for a registered feed.
    Map(Symbol),
}

#[contract]
pub struct ReflectorFeed;

#[contractimpl]
impl ReflectorFeed {
    /// `oracle` = the live Reflector contract ID (e.g. the testnet CEX/DEX feed).
    pub fn init(e: Env, admin: Address, oracle: Address) -> Result<(), Error> {
        if e.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Oracle, &oracle);
        Ok(())
    }

    /// Admin: register `our_symbol` (what the adapter passes) → the Reflector `Asset`.
    /// e.g. `map_asset("XLM", Asset::Other("XLM"))`.
    pub fn map_asset(e: Env, our_symbol: Symbol, reflector_asset: Asset) -> Result<(), Error> {
        Self::admin(&e)?.require_auth();
        let key = DataKey::Map(our_symbol);
        e.storage().persistent().set(&key, &reflector_asset);
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// The `PriceFeed` surface the oracle-adapter requires. Maps `asset` to its
    /// Reflector `Asset` and forwards the read. `None` if unmapped or Reflector misses.
    pub fn lastprice(e: Env, asset: Symbol) -> Option<PriceData> {
        let key = DataKey::Map(asset);
        let reflector_asset: Asset = e.storage().persistent().get(&key)?;
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        let oracle: Address = e.storage().instance().get(&DataKey::Oracle)?;
        match ReflectorClient::new(&e, &oracle).try_lastprice(&reflector_asset) {
            Ok(Ok(Some(p))) => Some(p),
            _ => None, // fail-closed: any miss/failure → None
        }
    }

    /// The Reflector oracle this shim reads (ops/monitoring).
    pub fn oracle(e: Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::Oracle)
    }

    fn admin(e: &Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod test;
