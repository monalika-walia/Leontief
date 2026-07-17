//! oracle-adapter — fail-closed NAV source for vaults and pools (spec §5, prompt C2).
//!
//! `get_nav` returns a SCALE-scaled (10^12) NAV only when **all** checks hold:
//! feed configured, price present and positive, normalized without overflow, not
//! stale, and within the per-update deviation bound against the last accepted NAV.
//! Any failure is a typed error — **no fallback prices, no silent staleness, ever.**
//! Consumers halt their pricing-dependent operations on error (fail-closed).
#![no_std]

mod constants;

use constants::{
    DEFAULT_MAX_AGE_SECS, DEFAULT_MAX_DEV_BPS, SCALE_DECIMALS, TTL_EXTEND_TO, TTL_THRESHOLD,
};
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, Address,
    Env, Symbol,
};

/// SEP-40-shaped price point — must stay XDR-identical to the source's type
/// (mock-oracle now, Reflector in X1).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// The read surface this adapter requires from any price source.
#[contractclient(name = "PriceFeedClient")]
pub trait PriceFeed {
    fn lastprice(e: Env, asset: Symbol) -> Option<PriceData>;
}

/// A NAV accepted by every fail-closed check. `nav` is SCALE-scaled (10^12);
/// `ts` is the source feed's timestamp.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NavData {
    pub nav: i128,
    pub ts: u64,
}

/// Per-asset feed configuration (persistent storage).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeedConfig {
    pub source: Address,
    pub source_decimals: u32,
    pub max_age_secs: u64,
    pub max_dev_bps: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    Unauthorized = 2,
    AlreadyInitialized = 3,
    NotConfigured = 4,
    OracleFailure = 5,
    StalePrice = 6,
    DeviationExceeded = 7,
    MathOverflow = 8,
    InvalidConfig = 9,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Feed(Symbol),
    Last(Symbol),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeedConfigured {
    #[topic]
    pub asset: Symbol,
    pub source: Address,
    pub source_decimals: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoundsSet {
    #[topic]
    pub asset: Symbol,
    pub max_age_secs: u64,
    pub max_dev_bps: u32,
}

/// Loud by design: monitoring alerts on every occurrence (docs-hub §05).
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OverrideAccepted {
    #[topic]
    pub asset: Symbol,
    pub nav: i128,
    pub ts: u64,
}

/// Normalize a positive source price quoted at `source_decimals` to SCALE (10^12).
/// Floors when scaling down; `None` on overflow. Pure — property-tested for
/// round-trip within 1 ulp (tests/normalization_prop.rs).
pub fn normalize_price(price: i128, source_decimals: u32) -> Option<i128> {
    if price <= 0 {
        return None;
    }
    if source_decimals <= SCALE_DECIMALS {
        price.checked_mul(pow10(SCALE_DECIMALS - source_decimals)?)
    } else {
        // Positive operands: `/` floors.
        Some(price / pow10(source_decimals - SCALE_DECIMALS)?)
    }
}

fn pow10(n: u32) -> Option<i128> {
    10_i128.checked_pow(n)
}

#[contract]
pub struct OracleAdapter;

#[contractimpl]
impl OracleAdapter {
    pub fn init(e: Env, admin: Address) -> Result<(), Error> {
        if e.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// The fail-closed NAV read. State-changing only in the invariant-preserving
    /// sense: on success it advances `last_accepted` with fully validated data, so
    /// it is deliberately callable by anyone — callers cannot inject values, and
    /// keeping the breaker state fresh only tightens protection.
    pub fn get_nav(e: Env, asset: Symbol) -> Result<NavData, Error> {
        let feed_key = DataKey::Feed(asset.clone());
        let cfg: FeedConfig = e
            .storage()
            .persistent()
            .get(&feed_key)
            .ok_or(Error::NotConfigured)?;
        e.storage()
            .persistent()
            .extend_ttl(&feed_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        // 1 · Source must answer with a present price (any invocation failure,
        //     absent feed, or non-positive price ⇒ fail closed).
        let price = match PriceFeedClient::new(&e, &cfg.source).try_lastprice(&asset) {
            Ok(Ok(Some(p))) => p,
            _ => return Err(Error::OracleFailure),
        };
        if price.price <= 0 {
            return Err(Error::OracleFailure);
        }

        // 2 · Normalize source decimals → SCALE with checked math.
        let nav = normalize_price(price.price, cfg.source_decimals).ok_or(Error::MathOverflow)?;
        if nav == 0 {
            return Err(Error::OracleFailure);
        }

        // 3 · Staleness. A timestamp from the future is an anomaly ⇒ fail closed.
        let now = e.ledger().timestamp();
        let age = now
            .checked_sub(price.timestamp)
            .ok_or(Error::OracleFailure)?;
        if age > cfg.max_age_secs {
            return Err(Error::StalePrice);
        }

        // 4 · Per-update deviation against the last accepted NAV.
        let last_key = DataKey::Last(asset.clone());
        if let Some(last) = e.storage().persistent().get::<_, NavData>(&last_key) {
            let diff = nav.abs_diff(last.nav);
            let lhs = diff.checked_mul(10_000).ok_or(Error::MathOverflow)?;
            let rhs = (last.nav as u128)
                .checked_mul(cfg.max_dev_bps as u128)
                .ok_or(Error::MathOverflow)?;
            if lhs > rhs {
                return Err(Error::DeviationExceeded);
            }
        }

        // 5 · Accept: record and return.
        let out = NavData {
            nav,
            ts: price.timestamp,
        };
        e.storage().persistent().set(&last_key, &out);
        e.storage()
            .persistent()
            .extend_ttl(&last_key, TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(out)
    }

    /// Admin: (re)configure an asset's feed with default bounds. Clears any
    /// previous `last_accepted` — a new source is a new pricing regime.
    pub fn configure_feed(
        e: Env,
        asset: Symbol,
        source: Address,
        source_decimals: u32,
    ) -> Result<(), Error> {
        Self::admin(&e)?.require_auth();
        // 10^38 overflows i128; anything near it is a misconfiguration.
        if source_decimals > 38 {
            return Err(Error::InvalidConfig);
        }
        let cfg = FeedConfig {
            source: source.clone(),
            source_decimals,
            max_age_secs: DEFAULT_MAX_AGE_SECS,
            max_dev_bps: DEFAULT_MAX_DEV_BPS,
        };
        let key = DataKey::Feed(asset.clone());
        e.storage().persistent().set(&key, &cfg);
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        e.storage()
            .persistent()
            .remove(&DataKey::Last(asset.clone()));
        FeedConfigured {
            asset,
            source,
            source_decimals,
        }
        .publish(&e);
        Ok(())
    }

    /// Admin: adjust the fail-closed bounds for a configured asset.
    pub fn set_bounds(
        e: Env,
        asset: Symbol,
        max_age_secs: u64,
        max_dev_bps: u32,
    ) -> Result<(), Error> {
        Self::admin(&e)?.require_auth();
        let key = DataKey::Feed(asset.clone());
        let mut cfg: FeedConfig = e
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotConfigured)?;
        cfg.max_age_secs = max_age_secs;
        cfg.max_dev_bps = max_dev_bps;
        e.storage().persistent().set(&key, &cfg);
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        BoundsSet {
            asset,
            max_age_secs,
            max_dev_bps,
        }
        .publish(&e);
        Ok(())
    }

    /// Admin: re-arm a halted feed after human investigation by planting a new
    /// `last_accepted`. **Prototype-only escape hatch** (DECISIONS.md #2): mainnet
    /// re-arming goes through the multisig + timelock flow. Emits a loud event
    /// that monitoring treats as an incident (docs-hub §05).
    pub fn accept_override(e: Env, asset: Symbol, nav: i128) -> Result<(), Error> {
        Self::admin(&e)?.require_auth();
        if nav <= 0 {
            return Err(Error::InvalidConfig);
        }
        if !e.storage().persistent().has(&DataKey::Feed(asset.clone())) {
            return Err(Error::NotConfigured);
        }
        let ts = e.ledger().timestamp();
        let key = DataKey::Last(asset.clone());
        e.storage().persistent().set(&key, &NavData { nav, ts });
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        OverrideAccepted { asset, nav, ts }.publish(&e);
        Ok(())
    }

    /// Read: current feed config (issuer panel / monitoring).
    pub fn feed_config(e: Env, asset: Symbol) -> Option<FeedConfig> {
        e.storage().persistent().get(&DataKey::Feed(asset))
    }

    /// Read: last accepted NAV without running the checks (issuer panel / monitoring).
    pub fn last_accepted(e: Env, asset: Symbol) -> Option<NavData> {
        e.storage().persistent().get(&DataKey::Last(asset))
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
