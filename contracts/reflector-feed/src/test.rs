#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

/// A stand-in Reflector: returns a configured price for `Asset::Other("XLM")`,
/// `None` for anything else — mirroring a real feed's per-asset coverage.
#[contract]
struct MockReflector;
#[contractimpl]
impl MockReflector {
    pub fn seed(e: Env, price: i128, ts: u64) {
        e.storage().instance().set(&0u32, &price);
        e.storage().instance().set(&1u32, &ts);
    }
    pub fn lastprice(e: Env, asset: Asset) -> Option<PriceData> {
        if asset == Asset::Other(Symbol::new(&e, "XLM")) {
            Some(PriceData {
                price: e.storage().instance().get(&0u32).unwrap_or(0),
                timestamp: e.storage().instance().get(&1u32).unwrap_or(0),
            })
        } else {
            None
        }
    }
}

struct World {
    e: Env,
    feed: ReflectorFeedClient<'static>,
    reflector_id: Address,
}

fn setup() -> World {
    let e = Env::default();
    let admin = Address::generate(&e);
    let reflector_id = e.register(MockReflector, ());
    // 14-dp price like the real Reflector: 0.12 USD → 12_000_000_000_000
    MockReflectorClient::new(&e, &reflector_id).seed(&12_000_000_000_000, &1_700_000_000);

    let id = e.register(ReflectorFeed, ());
    let feed = ReflectorFeedClient::new(&e, &id);
    feed.init(&admin, &reflector_id);
    e.mock_all_auths();
    World {
        e,
        feed,
        reflector_id,
    }
}

#[test]
fn maps_symbol_and_forwards_reflector_price() {
    let w = setup();
    let xlm = Symbol::new(&w.e, "XLM");
    w.feed.map_asset(&xlm, &Asset::Other(xlm.clone()));

    let p = w.feed.lastprice(&xlm).unwrap();
    assert_eq!(p.price, 12_000_000_000_000); // passed through un-rescaled (14 dp)
    assert_eq!(p.timestamp, 1_700_000_000);
}

#[test]
fn unmapped_symbol_is_none() {
    let w = setup();
    // Never mapped → None (adapter treats as OracleFailure, fail-closed).
    assert_eq!(w.feed.lastprice(&Symbol::new(&w.e, "BTC")), None);
}

#[test]
fn mapped_to_asset_reflector_lacks_is_none() {
    let w = setup();
    // Map our "GOLD" to an Asset the mock Reflector does not carry → None.
    let gold = Symbol::new(&w.e, "GOLD");
    w.feed
        .map_asset(&gold, &Asset::Other(Symbol::new(&w.e, "XAU")));
    assert_eq!(w.feed.lastprice(&gold), None);
}

#[test]
fn oracle_getter_returns_configured_reflector() {
    let w = setup();
    assert_eq!(w.feed.oracle(), Some(w.reflector_id.clone()));
}

#[test]
fn double_init_rejected() {
    let w = setup();
    let a = Address::generate(&w.e);
    let o = Address::generate(&w.e);
    assert_eq!(w.feed.try_init(&a, &o), Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn map_requires_admin_auth() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let oracle = Address::generate(&e);
    let id = e.register(ReflectorFeed, ());
    let feed = ReflectorFeedClient::new(&e, &id);
    feed.init(&admin, &oracle);
    // no mock_all_auths → admin require_auth must reject
    let xlm = Symbol::new(&e, "XLM");
    assert!(feed
        .try_map_asset(&xlm, &Asset::Other(xlm.clone()))
        .is_err());
}
