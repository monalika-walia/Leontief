#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{map, symbol_short, vec, Address, Env, IntoVal, Val};

/// 1.0209 and 1.0409 quoted at 14 decimals — the C8 golden-vector NAV points.
const NAV14_1_0209: i128 = 102_090_000_000_000;
const NAV14_1_0409: i128 = 104_090_000_000_000;

fn setup(decimals: u32) -> (Env, MockOracleClient<'static>, Address) {
    let e = Env::default();
    let id = e.register(MockOracle, ());
    let client = MockOracleClient::new(&e, &id);
    let admin = Address::generate(&e);
    e.mock_all_auths();
    client.init(&admin, &decimals);
    (e, client, admin)
}

#[test]
fn read_after_set() {
    let (_e, client, _admin) = setup(14);
    client.set_price(&symbol_short!("LEOD"), &NAV14_1_0209, &1_000);
    assert_eq!(
        client.lastprice(&symbol_short!("LEOD")),
        Some(PriceData {
            price: NAV14_1_0209,
            timestamp: 1_000
        })
    );
    // Overwrite is allowed — drills re-plant prices freely.
    client.set_price(&symbol_short!("LEOD"), &NAV14_1_0409, &2_000);
    assert_eq!(
        client.lastprice(&symbol_short!("LEOD")),
        Some(PriceData {
            price: NAV14_1_0409,
            timestamp: 2_000
        })
    );
}

#[test]
fn unknown_asset_returns_none() {
    let (_e, client, _admin) = setup(14);
    assert_eq!(client.lastprice(&symbol_short!("NOPE")), None);
}

#[test]
fn set_price_requires_admin_auth() {
    let e = Env::default();
    let id = e.register(MockOracle, ());
    let client = MockOracleClient::new(&e, &id);
    let admin = Address::generate(&e);
    e.mock_all_auths();
    client.init(&admin, &14);
    // Drop auth mocking: the admin's require_auth must now fail.
    e.set_auths(&[]);
    assert!(client
        .try_set_price(&symbol_short!("LEOD"), &1, &1)
        .is_err());
}

#[test]
fn set_price_records_admin_auth() {
    let (e, client, admin) = setup(14);
    client.set_price(&symbol_short!("LEOD"), &1, &1);
    assert_eq!(e.auths()[0].0, admin);
}

#[test]
fn decimals_immutable_after_init() {
    let (_e, client, _admin) = setup(14);
    assert_eq!(client.decimals(), 14);
    let res = client.try_set_decimals(&7);
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized)));
    assert_eq!(client.decimals(), 14);
}

#[test]
fn init_twice_rejected() {
    let (e, client, _admin) = setup(14);
    let other = Address::generate(&e);
    assert_eq!(
        client.try_init(&other, &7),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn reads_before_init_fail_typed() {
    let e = Env::default();
    let id = e.register(MockOracle, ());
    let client = MockOracleClient::new(&e, &id);
    assert_eq!(client.try_decimals(), Err(Ok(Error::NotInitialized)));
    e.mock_all_auths();
    assert_eq!(
        client.try_set_price(&symbol_short!("LEOD"), &1, &1),
        Err(Ok(Error::NotInitialized))
    );
}

#[test]
fn price_set_event_emitted() {
    let (e, client, _admin) = setup(14);
    let id = client.address.clone();
    client.set_price(&symbol_short!("LEOD"), &42, &7);
    let data: soroban_sdk::Map<Symbol, Val> = map![
        &e,
        (symbol_short!("price"), 42_i128.into_val(&e)),
        (symbol_short!("ts"), 7_u64.into_val(&e))
    ];
    assert_eq!(
        e.events().all(),
        vec![
            &e,
            (
                id,
                (symbol_short!("price_set"), symbol_short!("LEOD")).into_val(&e),
                data.into_val(&e)
            ),
        ]
    );
}
