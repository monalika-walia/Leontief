//! blend-price-adapter — the SEP-40 price oracle a Blend pool consumes to accept
//! `ld-shares` as collateral (prompt X2).
//!
//! A Blend pool calls its oracle with `lastprice(Asset::Stellar(addr))` + `decimals()`
//! and values every reserve in a common base (USD). This adapter answers:
//!   • an **ld-share** asset → the vault's `share_price()` — already the SCALE-scaled
//!     USD price of one share (NAV enters exactly once; DECISIONS #3). We pass it
//!     through and report `decimals() = 12`, so there is no re-scaling and NAV is
//!     never double-counted.
//!   • a **pinned** asset (e.g. USDC ≈ $1) → a configured fixed price.
//!
//! **Fail-closed:** if the vault's `share_price()` reverts (its oracle is stale or
//! the breaker tripped) or is non-positive, `lastprice` returns `None`. Blend then
//! cannot value the collateral and its own protections engage — the halt propagates.
#![no_std]

mod constants;

use constants::{PRICE_DECIMALS, TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, Address,
    Env, Symbol,
};

/// SEP-40 asset selector — XDR-identical to Reflector's and the shape a Blend pool
/// uses (`Asset::Stellar(addr)` for Soroban assets).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

/// SEP-40 price point — XDR-identical to the source oracle's `PriceData`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// How this adapter prices a registered asset.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Source {
    /// Read `share_price()` from this vault (the ld-share). Fail-closed.
    Vault(Address),
    /// A pinned SCALE-scaled (10^12) price, e.g. USDC = 1_000_000_000_000.
    Fixed(i128),
}

/// The vault read surface we require — only `share_price()`.
#[contractclient(name = "VaultClient")]
pub trait VaultShare {
    fn share_price(e: Env) -> i128;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    Unauthorized = 2,
    AlreadyInitialized = 3,
    InvalidConfig = 4,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    /// Registered price source, keyed by the asset's contract address.
    Src(Address),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceSet {
    #[topic]
    pub asset: Address,
    pub source: Source,
}

#[contract]
pub struct BlendPriceAdapter;

#[contractimpl]
impl BlendPriceAdapter {
    pub fn init(e: Env, admin: Address) -> Result<(), Error> {
        if e.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Admin: register an ld-share asset priced from a vault's `share_price()`.
    pub fn set_vault_source(e: Env, asset: Address, vault: Address) -> Result<(), Error> {
        Self::admin(&e)?.require_auth();
        let source = Source::Vault(vault);
        Self::store_source(&e, &asset, &source);
        SourceSet { asset, source }.publish(&e);
        Ok(())
    }

    /// Admin: register a pinned price (SCALE-scaled) for an asset, e.g. USDC = $1.
    pub fn set_fixed_source(e: Env, asset: Address, price: i128) -> Result<(), Error> {
        Self::admin(&e)?.require_auth();
        if price <= 0 {
            return Err(Error::InvalidConfig);
        }
        let source = Source::Fixed(price);
        Self::store_source(&e, &asset, &source);
        SourceSet { asset, source }.publish(&e);
        Ok(())
    }

    /// Admin: drop an asset's price source.
    pub fn remove_source(e: Env, asset: Address) -> Result<(), Error> {
        Self::admin(&e)?.require_auth();
        e.storage().persistent().remove(&DataKey::Src(asset));
        Ok(())
    }

    // ── SEP-40 read surface (what Blend calls) ─────────────────────────────────

    /// The price of one unit of `asset` in the oracle base (USD), or `None` if the
    /// asset is unregistered or the underlying price is unavailable (**fail-closed**).
    pub fn lastprice(e: Env, asset: Asset) -> Option<PriceData> {
        let addr = match asset {
            Asset::Stellar(a) => a,
            Asset::Other(_) => return None,
        };
        let source: Source = e.storage().persistent().get(&DataKey::Src(addr.clone()))?;
        e.storage()
            .persistent()
            .extend_ttl(&DataKey::Src(addr), TTL_THRESHOLD, TTL_EXTEND_TO);

        let price = match source {
            // Fail-closed: only a successful, positive share_price yields a price.
            Source::Vault(vault) => match VaultClient::new(&e, &vault).try_share_price() {
                Ok(Ok(p)) if p > 0 => p,
                _ => return None,
            },
            Source::Fixed(p) => p,
        };
        Some(PriceData {
            price,
            timestamp: e.ledger().timestamp(),
        })
    }

    /// SEP-40 historical read. This oracle is computed live and keeps no history,
    /// so it returns the current price for any timestamp (never a stale cached one).
    pub fn price(e: Env, asset: Asset, _timestamp: u64) -> Option<PriceData> {
        Self::lastprice(e, asset)
    }

    /// Price scale: `share_price` is 10^12-scaled, so we report 12 and pass through.
    pub fn decimals(_e: Env) -> u32 {
        PRICE_DECIMALS
    }

    /// The common quote base — USD (all reserves priced in USD).
    pub fn base(e: Env) -> Asset {
        Asset::Other(Symbol::new(&e, "USD"))
    }

    /// Read the configured source for an asset (for ops/monitoring).
    pub fn source(e: Env, asset: Address) -> Option<Source> {
        e.storage().persistent().get(&DataKey::Src(asset))
    }

    // ── internals ──────────────────────────────────────────────────────────────

    fn admin(e: &Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    fn store_source(e: &Env, asset: &Address, source: &Source) {
        let key = DataKey::Src(asset.clone());
        e.storage().persistent().set(&key, source);
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod test;
