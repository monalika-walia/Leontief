#![cfg(test)]
use super::*;
use mock_oracle::{MockOracle, MockOracleClient};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{symbol_short, Address, Env, Symbol};

/// The real vault, compiled to wasm — the exact artifact the factory deploys.
/// Build first: `cargo build -p vault --target wasm32v1-none --release`
/// (`just test` and CI do this automatically).
mod vault_wasm {
    soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/vault.wasm");
}

const LEOD: Symbol = symbol_short!("LEOD");
const SCALE: i128 = 1_000_000_000_000;
const CAP: i128 = 10_000_000_000_000_000;

struct Setup {
    e: Env,
    factory: VaultFactoryClient<'static>,
    admin: Address,
    underlying: Address,
    underlying_admin: StellarAssetClient<'static>,
    oracle: Address,
    mock: MockOracleClient<'static>,
}

fn setup() -> Setup {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|l| {
        l.timestamp = 1_000;
        l.sequence_number = 100;
    });
    let admin = Address::generate(&e);

    let sac = e.register_stellar_asset_contract_v2(admin.clone());
    let underlying_admin = StellarAssetClient::new(&e, &sac.address());

    let mock_id = e.register(MockOracle, ());
    let mock = MockOracleClient::new(&e, &mock_id);
    mock.init(&admin, &12);
    mock.set_price(&LEOD, &SCALE, &1_000);

    let adapter_id = e.register(OracleAdapter, ());
    let adapter = OracleAdapterClient::new(&e, &adapter_id);
    adapter.init(&admin);
    adapter.configure_feed(&LEOD, &mock_id, &12);

    let wasm_hash = e.deployer().upload_contract_wasm(vault_wasm::WASM);
    let factory_id = e.register(VaultFactory, ());
    let factory = VaultFactoryClient::new(&e, &factory_id);
    factory.init(&admin, &wasm_hash);

    Setup {
        e,
        factory,
        admin,
        underlying: sac.address(),
        underlying_admin,
        oracle: adapter_id,
        mock,
    }
}

#[test]
fn deploy_registers_and_initializes_child() {
    let s = setup();
    let vault_addr = s
        .factory
        .deploy_vault(&s.underlying, &s.oracle, &LEOD, &CAP);
    assert_eq!(s.factory.vault_of(&s.underlying), Some(vault_addr.clone()));

    let vault = vault_wasm::Client::new(&s.e, &vault_addr);
    // Child admin is the FACTORY's admin (humans/multisig), not the factory.
    assert_eq!(vault.admin(), s.admin);
    assert_eq!(vault.cap(), CAP);
    assert_eq!(vault.asset_id(), LEOD);
    assert_eq!(vault.underlying(), s.underlying);
    assert_eq!(vault.oracle(), s.oracle);
    assert_eq!(vault.total_shares(), 0);
}

#[test]
fn duplicate_underlying_rejected() {
    let s = setup();
    s.factory
        .deploy_vault(&s.underlying, &s.oracle, &LEOD, &CAP);
    assert_eq!(
        s.factory
            .try_deploy_vault(&s.underlying, &s.oracle, &LEOD, &CAP)
            .unwrap_err(),
        Ok(Error::AlreadyDeployed)
    );
}

#[test]
fn unknown_underlying_is_none() {
    let s = setup();
    let other = Address::generate(&s.e);
    assert_eq!(s.factory.vault_of(&other), None);
}

#[test]
fn deploy_validates_input_and_auth() {
    let s = setup();
    assert_eq!(
        s.factory
            .try_deploy_vault(&s.underlying, &s.oracle, &LEOD, &-1)
            .unwrap_err(),
        Ok(Error::InvalidInput)
    );
    s.e.set_auths(&[]);
    assert!(s
        .factory
        .try_deploy_vault(&s.underlying, &s.oracle, &LEOD, &CAP)
        .is_err());
    let hash = soroban_sdk::BytesN::from_array(&s.e, &[9u8; 32]);
    assert!(s.factory.try_set_wasm_hash(&hash).is_err());
}

#[test]
fn init_lifecycle() {
    let e = Env::default();
    e.mock_all_auths();
    let factory_id = e.register(VaultFactory, ());
    let factory = VaultFactoryClient::new(&e, &factory_id);
    let admin = Address::generate(&e);
    let hash: soroban_sdk::BytesN<32> = soroban_sdk::BytesN::from_array(&e, &[7u8; 32]);
    let underlying = Address::generate(&e);
    assert_eq!(
        factory
            .try_deploy_vault(&underlying, &admin, &LEOD, &CAP)
            .unwrap_err(),
        Ok(Error::NotInitialized)
    );
    factory.init(&admin, &hash);
    assert_eq!(factory.admin(), admin);
    assert_eq!(
        factory.try_init(&admin, &hash).unwrap_err(),
        Ok(Error::AlreadyInitialized)
    );
}

/// The C3 core fixture run against the FACTORY-deployed instance: identical
/// deposit math, fairness across a NAV tick, round-trip ≤, pause semantics,
/// donation behavior, SEP-41 transfer (full unit suite: vault/src/test.rs).
#[test]
fn factory_deployed_vault_passes_c3_core_fixture() {
    let s = setup();
    let vault_addr = s
        .factory
        .deploy_vault(&s.underlying, &s.oracle, &LEOD, &CAP);
    let vault = vault_wasm::Client::new(&s.e, &vault_addr);
    let underlying = TokenClient::new(&s.e, &s.underlying);

    let alice = Address::generate(&s.e);
    let bob = Address::generate(&s.e);
    s.underlying_admin.mint(&alice, &100_0000000);
    s.underlying_admin.mint(&bob, &100_0000000);

    // First deposit at NAV 1.0 mints 1:1 on value.
    let alice_shares = vault.deposit(&alice, &100_0000000);
    assert_eq!(alice_shares, 100_0000000);

    // NAV tick +1.9% (inside deviation): share_price rises, fairness holds.
    let p0 = vault.share_price();
    s.mock.set_price(&LEOD, &1_019_000_000_000, &1_000);
    let p1 = vault.share_price();
    assert!(p1 > p0);

    let bob_shares = vault.deposit(&bob, &100_0000000);
    let bob_value = vault.share_price() * bob_shares / SCALE;
    let contributed = 100_0000000_i128 * 1_019 / 1_000;
    assert!(bob_value <= contributed && contributed - bob_value <= 2);

    // Donation mints nothing, raises price.
    let donor = Address::generate(&s.e);
    s.underlying_admin.mint(&donor, &10_0000000);
    let s0 = vault.total_shares();
    let p2 = vault.share_price();
    underlying.transfer(&donor, &vault_addr, &10_0000000);
    assert_eq!(vault.total_shares(), s0);
    assert!(vault.share_price() > p2);

    // Pause blocks deposits, never exits; SEP-41 transfer conserves supply.
    vault.pause();
    assert!(vault.try_deposit(&alice, &1).is_err());
    vault.transfer(&alice, &bob, &1_0000000);
    let out = vault.withdraw(&bob, &(bob_shares + 1_0000000));
    assert!(out > 0);
    vault.unpause();

    // Round trip never profits.
    let rest = vault.balance(&alice);
    let back = vault.withdraw(&alice, &rest);
    assert!(back <= 100_0000000 + 10_0000000); // deposit + donation share upper bound
}
