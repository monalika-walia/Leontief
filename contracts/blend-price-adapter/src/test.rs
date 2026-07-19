#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, Env};

// ── Mock vaults ──────────────────────────────────────────────────────────────

/// A vault whose `share_price()` returns a fixed, healthy value.
#[contract]
struct GoodVault;
#[contractimpl]
impl GoodVault {
    pub fn set(e: Env, price: i128) {
        e.storage().instance().set(&(), &price);
    }
    pub fn share_price(e: Env) -> i128 {
        e.storage().instance().get(&()).unwrap_or(0)
    }
}

/// A vault whose `share_price()` panics — models a tripped/stale oracle breaker.
#[contract]
struct HaltedVault;
#[contractimpl]
impl HaltedVault {
    pub fn share_price(_e: Env) -> i128 {
        panic!("oracle halted");
    }
}

// ── Harness ──────────────────────────────────────────────────────────────────

struct World {
    e: Env,
    adapter: BlendPriceAdapterClient<'static>,
    admin: Address,
}

fn setup() -> World {
    let e = Env::default();
    e.ledger().set_timestamp(1_700_000_000);
    let admin = Address::generate(&e);
    let id = e.register(BlendPriceAdapter, ());
    let adapter = BlendPriceAdapterClient::new(&e, &id);
    adapter.init(&admin);
    World { e, adapter, admin }
}

const SCALE: i128 = 1_000_000_000_000;

fn good_vault(e: &Env, price: i128) -> Address {
    let id = e.register(GoodVault, ());
    GoodVaultClient::new(e, &id).set(&price);
    id
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[test]
fn decimals_is_scale() {
    let w = setup();
    assert_eq!(w.adapter.decimals(), 12);
}

#[test]
fn base_is_usd() {
    let w = setup();
    assert_eq!(w.adapter.base(), Asset::Other(Symbol::new(&w.e, "USD")));
}

#[test]
fn vault_source_returns_share_price_at_now() {
    let w = setup();
    let ld = Address::generate(&w.e); // the ld-share token address Blend queries
    let vault = good_vault(&w.e, 1_020_900_000_000); // NAV-accrued share price
    w.e.mock_all_auths();
    w.adapter.set_vault_source(&ld, &vault);

    let p = w.adapter.lastprice(&Asset::Stellar(ld)).unwrap();
    assert_eq!(p.price, 1_020_900_000_000);
    assert_eq!(p.timestamp, 1_700_000_000);
}

#[test]
fn fixed_source_pins_usdc_at_one() {
    let w = setup();
    let usdc = Address::generate(&w.e);
    w.e.mock_all_auths();
    w.adapter.set_fixed_source(&usdc, &SCALE);

    let p = w.adapter.lastprice(&Asset::Stellar(usdc)).unwrap();
    assert_eq!(p.price, SCALE); // exactly $1.00 at 12 decimals
}

#[test]
fn fail_closed_when_vault_reverts() {
    let w = setup();
    let ld = Address::generate(&w.e);
    let halted = w.e.register(HaltedVault, ());
    w.e.mock_all_auths();
    w.adapter.set_vault_source(&ld, &halted);

    // The vault's share_price panics → adapter returns None, never a stale price.
    assert_eq!(w.adapter.lastprice(&Asset::Stellar(ld)), None);
}

#[test]
fn fail_closed_when_share_price_nonpositive() {
    let w = setup();
    let ld = Address::generate(&w.e);
    let vault = good_vault(&w.e, 0); // degenerate/empty vault
    w.e.mock_all_auths();
    w.adapter.set_vault_source(&ld, &vault);

    assert_eq!(w.adapter.lastprice(&Asset::Stellar(ld)), None);
}

#[test]
fn unregistered_asset_is_none() {
    let w = setup();
    let unknown = Address::generate(&w.e);
    assert_eq!(w.adapter.lastprice(&Asset::Stellar(unknown)), None);
}

#[test]
fn other_asset_kind_is_none() {
    let w = setup();
    // Blend prices Soroban assets as Stellar(addr); a bare symbol is not ours.
    assert_eq!(
        w.adapter.lastprice(&Asset::Other(Symbol::new(&w.e, "BTC"))),
        None
    );
}

#[test]
fn price_history_returns_live_value() {
    let w = setup();
    let ld = Address::generate(&w.e);
    let vault = good_vault(&w.e, 999_000_000_000);
    w.e.mock_all_auths();
    w.adapter.set_vault_source(&ld, &vault);

    // Any timestamp yields the current price (no stale cache).
    let p = w.adapter.price(&Asset::Stellar(ld), &123).unwrap();
    assert_eq!(p.price, 999_000_000_000);
}

#[test]
fn remove_source_makes_it_none() {
    let w = setup();
    let usdc = Address::generate(&w.e);
    w.e.mock_all_auths();
    w.adapter.set_fixed_source(&usdc, &SCALE);
    assert!(w.adapter.lastprice(&Asset::Stellar(usdc.clone())).is_some());
    w.adapter.remove_source(&usdc);
    assert_eq!(w.adapter.lastprice(&Asset::Stellar(usdc)), None);
}

#[test]
fn set_fixed_rejects_nonpositive() {
    let w = setup();
    let a = Address::generate(&w.e);
    w.e.mock_all_auths();
    let r = w.adapter.try_set_fixed_source(&a, &0);
    assert_eq!(r, Err(Ok(Error::InvalidConfig)));
}

#[test]
fn config_requires_admin_auth() {
    let w = setup();
    let a = Address::generate(&w.e);
    let vault = good_vault(&w.e, SCALE);
    // No mock_all_auths → the require_auth() must reject.
    let r = w.adapter.try_set_vault_source(&a, &vault);
    assert!(r.is_err());
    let _ = w.admin;
}

#[test]
fn double_init_rejected() {
    let w = setup();
    let other = Address::generate(&w.e);
    assert_eq!(
        w.adapter.try_init(&other),
        Err(Ok(Error::AlreadyInitialized))
    );
}
