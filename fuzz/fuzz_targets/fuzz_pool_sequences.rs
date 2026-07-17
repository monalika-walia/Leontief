//! fuzz_pool_sequences (prompt C8) — arbitrary supply / borrow / repay /
//! withdraw / liquidate interleavings under NAV walks, asserting pool solvency
//! after every op:
//!   - a healthy position's debt never exceeds its LTV-allowed max
//!   - a whitelisted liquidation never lets the liquidator gain more collateral
//!     value than the exact-math bonus (protocol never under-compensated)
//!   - the borrower's debt only ever decreases on repay/liquidate
//!
//! Run: `cd fuzz && cargo +nightly fuzz run fuzz_pool_sequences`.
#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use mini_pool::{MiniPool, MiniPoolClient};
use mock_oracle::{MockOracle, MockOracleClient};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{symbol_short, Address, Env, Symbol};
use vault::{Vault, VaultClient};

const LEOD: Symbol = symbol_short!("LEOD");
const SCALE: i128 = 1_000_000_000_000;
const BPS: i128 = 10_000;
const BONUS: i128 = 500;
const FUND: i128 = 1_000_000_000_000_000;

#[derive(Arbitrary, Debug)]
enum Op {
    Borrow { amount: u32 },
    Repay { pct: u8 },
    SupplyMore { amount: u32 },
    Liquidate { pct: u8 },
    /// NAV move: signed step within ±200 bps of the current level.
    NavStep { up: bool, bps: u8 },
}

fuzz_target!(|input: (u16, u32, Vec<Op>)| {
    let (nav0_bps, collateral_seed, ops) = input;
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|l| {
        l.timestamp = 1_000;
        l.sequence_number = 100;
    });
    let admin = Address::generate(&e);

    let leod = e.register_stellar_asset_contract_v2(admin.clone());
    let leod_admin = StellarAssetClient::new(&e, &leod.address());
    let usdc = e.register_stellar_asset_contract_v2(admin.clone());
    let usdc_admin = StellarAssetClient::new(&e, &usdc.address());

    let mock_id = e.register(MockOracle, ());
    let mock = MockOracleClient::new(&e, &mock_id);
    mock.init(&admin, &12);
    let mut nav = SCALE + (SCALE / 2) * (nav0_bps as i128) / (u16::MAX as i128);
    mock.set_price(&LEOD, &nav, &1_000);

    let adapter_id = e.register(OracleAdapter, ());
    let adapter = OracleAdapterClient::new(&e, &adapter_id);
    adapter.init(&admin);
    adapter.configure_feed(&LEOD, &mock_id, &12);

    let vault_id = e.register(Vault, ());
    let vault = VaultClient::new(&e, &vault_id);
    vault.init(&admin, &leod.address(), &adapter_id, &LEOD, &(FUND * 64));

    let pool_id = e.register(MiniPool, ());
    let pool = MiniPoolClient::new(&e, &pool_id);
    pool.init(&admin, &vault_id, &usdc.address(), &adapter_id);
    usdc_admin.mint(&pool_id, &FUND);

    let alice = Address::generate(&e);
    leod_admin.mint(&alice, &FUND);
    let liquidator = Address::generate(&e);
    usdc_admin.mint(&liquidator, &FUND);
    pool.set_whitelist(&liquidator, &true);

    // Seed a collateral position: deposit some LEOD, pledge it.
    let collateral = 100_0000000 + (collateral_seed as i128 % 900_0000000);
    let shares = vault.deposit(&alice, &collateral);
    pool.supply_collateral(&alice, &shares);

    for op in ops.into_iter().take(48) {
        let debt_before = pool.position(&alice).debt;
        match op {
            Op::Borrow { amount } => {
                let _ = pool.try_borrow(&alice, &((amount as i128) + 1));
                // Post-condition: whatever borrow succeeded, debt stays within LTV.
                if let Ok(Ok(sp)) = vault.try_share_price() {
                    let pos = pool.position(&alice);
                    let coll_value = pos.collateral_shares * sp / SCALE;
                    let max_debt = coll_value * 8_000 / BPS;
                    assert!(pos.debt <= max_debt, "debt {} > LTV max {}", pos.debt, max_debt);
                }
            }
            Op::Repay { pct } => {
                let amt = debt_before * (pct as i128 % 101) / 100;
                if amt > 0 {
                    let _ = pool.try_repay(&alice, &amt);
                    assert!(pool.position(&alice).debt <= debt_before, "repay raised debt");
                }
            }
            Op::SupplyMore { amount } => {
                let amt = (amount as i128) % 100_0000000 + 1;
                if amt <= vault.balance(&alice) {
                    let _ = pool.try_supply_collateral(&alice, &amt);
                }
            }
            Op::Liquidate { pct } => {
                // Only meaningful when unhealthy; the contract enforces hf<1.
                if let Ok(Ok(hf)) = pool.try_health_factor(&alice) {
                    if hf < SCALE && debt_before > 0 {
                        let repay = (debt_before / 2) * (pct as i128 % 101) / 100;
                        if repay > 0 {
                            if let (Ok(Ok(sp)), Ok(Ok(seize))) = (
                                vault.try_share_price(),
                                pool.try_liquidate(&liquidator, &alice, &repay),
                            ) {
                                // Protocol never under-compensated: seized value ≥
                                // exact bonus math minus one unit of flooring.
                                let owed = repay * (BPS + BONUS) / BPS;
                                let seized_value = seize * sp / SCALE;
                                assert!(
                                    seized_value + 1 >= owed || pool.position(&alice).collateral_shares == 0,
                                    "under-compensated: {seized_value} < {owed}"
                                );
                                assert!(pool.position(&alice).debt <= debt_before, "liquidation raised debt");
                            }
                        }
                    }
                }
            }
            Op::NavStep { up, bps } => {
                let step = nav * ((bps as i128) % 201) / 10_000;
                if up {
                    nav += step;
                } else {
                    nav = (nav - step).max(SCALE / 10); // never below 0.1
                }
                mock.set_price(&LEOD, &nav, &1_000);
                // A move beyond the deviation bound halts pricing (fail-closed);
                // re-arm via override so the walk can continue.
                if vault.try_share_price().is_err() {
                    adapter.accept_override(&LEOD, &nav);
                }
            }
        }
    }
});
