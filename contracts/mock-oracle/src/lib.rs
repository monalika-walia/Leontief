//! mock-oracle — SEP-40-shaped price feed for tests and testnet drills (spec §5, prompt C1).
//!
//! Exposes the exact read surface the oracle-adapter consumes so Reflector can be
//! swapped in later (Phase X1) with zero interface shims:
//! `lastprice(asset) -> Option<PriceData>` and `decimals() -> u32`.
//! Prices are set by an admin — this contract is a fixture, never a mainnet component.
#![no_std]

mod constants;

use constants::{TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, Symbol,
};

/// Emitted on every admin price write: topics `("price_set", asset)`, data `{price, ts}`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceSet {
    #[topic]
    pub asset: Symbol,
    pub price: i128,
    pub ts: u64,
}

/// Reflector-compatible price point (SEP-40 shape).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    Unauthorized = 2,
    UnknownAsset = 3,
    AlreadyInitialized = 4,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Decimals,
    Price(Symbol),
}

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    /// One-time initialization: admin + feed decimals. Decimals are immutable
    /// afterwards (`set_decimals` exists only to satisfy the init-once surface).
    pub fn init(e: Env, admin: Address, decimals: u32) -> Result<(), Error> {
        let inst = e.storage().instance();
        if inst.has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        inst.set(&DataKey::Admin, &admin);
        inst.set(&DataKey::Decimals, &decimals);
        Ok(())
    }

    /// Admin: set the price point for an asset. Timestamps are caller-provided on
    /// purpose — staleness drills need to plant old timestamps.
    pub fn set_price(e: Env, asset: Symbol, price: i128, ts: u64) -> Result<(), Error> {
        Self::admin(&e)?.require_auth();
        let key = DataKey::Price(asset.clone());
        e.storage().persistent().set(
            &key,
            &PriceData {
                price,
                timestamp: ts,
            },
        );
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        PriceSet { asset, price, ts }.publish(&e);
        Ok(())
    }

    /// Admin: init-once decimals setter. Always rejects after `init` — decimals
    /// immutability is part of the adapter's trust assumptions.
    pub fn set_decimals(e: Env, decimals: u32) -> Result<(), Error> {
        Self::admin(&e)?.require_auth();
        if e.storage().instance().has(&DataKey::Decimals) {
            return Err(Error::AlreadyInitialized);
        }
        e.storage().instance().set(&DataKey::Decimals, &decimals);
        Ok(())
    }

    /// SEP-40 read surface: latest price for `asset`, `None` when no feed exists.
    pub fn lastprice(e: Env, asset: Symbol) -> Option<PriceData> {
        e.storage().persistent().get(&DataKey::Price(asset))
    }

    /// SEP-40 read surface: decimals all prices are quoted in.
    pub fn decimals(e: Env) -> Result<u32, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Decimals)
            .ok_or(Error::NotInitialized)
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
