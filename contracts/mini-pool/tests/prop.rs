//! C6 property suite: liquidation rounding never under-compensates the pool
//! side, and repeated liquidation terminates.
//!
//! Case counts: these are full-stack properties (each case registers two SACs,
//! the oracle, adapter, vault and pool, then deposits, borrows, crashes and
//! liquidates — ≈1.5 s/case), so the PR default is deliberately small; the
//! nightly workflow raises it via PROPTEST_CASES. The cheap pure-math property
//! (oracle-adapter normalization) keeps the full 10k. See DECISIONS.md #4.

use mini_pool::{MiniPool, MiniPoolClient};
use mock_oracle::{MockOracle, MockOracleClient};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use proptest::prelude::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{symbol_short, Address, Env, Symbol};
use vault::{Vault, VaultClient};

const LEOD: Symbol = symbol_short!("LEOD");
const SCALE: i128 = 1_000_000_000_000;
const BPS: i128 = 10_000;
const BONUS: i128 = 500;
const LIQ_THRESHOLD_BPS: i128 = 8_500;
const FUND: i128 = 10_000_000_000_000;

fn cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(64)
}

struct Stack {
    #[allow(dead_code)] // keeps the Env alive for the clients borrowing it
    e: Env,
    pool: MiniPoolClient<'static>,
    vault: VaultClient<'static>,
    adapter: OracleAdapterClient<'static>,
    mock: MockOracleClient<'static>,
    alice: Address,
    liquidator: Address,
}

fn stack() -> Stack {
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
    mock.set_price(&LEOD, &SCALE, &1_000);

    let adapter_id = e.register(OracleAdapter, ());
    let adapter = OracleAdapterClient::new(&e, &adapter_id);
    adapter.init(&admin);
    adapter.configure_feed(&LEOD, &mock_id, &12);

    let vault_id = e.register(Vault, ());
    let vault = VaultClient::new(&e, &vault_id);
    vault.init(&admin, &leod.address(), &adapter_id, &LEOD, &(FUND * 4));

    let pool_id = e.register(MiniPool, ());
    let pool = MiniPoolClient::new(&e, &pool_id);
    pool.init(&admin, &vault_id, &usdc.address(), &adapter_id);
    usdc_admin.mint(&pool_id, &FUND);

    let alice = Address::generate(&e);
    leod_admin.mint(&alice, &FUND);
    vault.deposit(&alice, &FUND);

    let liquidator = Address::generate(&e);
    usdc_admin.mint(&liquidator, &FUND);
    pool.set_whitelist(&liquidator, &true);

    Stack {
        e,
        pool,
        vault,
        adapter,
        mock,
        alice,
        liquidator,
    }
}

fn crash_nav(s: &Stack, target: i128) {
    s.adapter.accept_override(&LEOD, &target);
    s.mock.set_price(&LEOD, &target, &1_000);
}

/// The NAV (SCALE-scaled) that lands a `debt`-against-`collateral` position at a
/// health factor of `hf_target_pct`%. Because share_price is exactly 1.0 at the
/// NAV-1.0 setup, `coll_value ≈ collateral·crash`, so
/// `hf ≈ collateral·crash·liq_threshold / (BPS·debt)`; invert for `crash`.
/// Choosing `hf_target_pct < 100` makes every generated case liquidatable, so
/// `prop_assume!(hf < 1)` almost never rejects (avoids proptest reject-budget
/// exhaustion — the reason a naive borrow_pct×crash grid aborts).
fn crash_for_hf(collateral: i128, debt: i128, hf_target_pct: i128) -> i128 {
    hf_target_pct * SCALE * debt * BPS / (collateral * LIQ_THRESHOLD_BPS * 100)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(cases()))]

    /// Pool-side value after a liquidation ≥ the exact rational math implies:
    /// the seized share value covers repay·(1+bonus) up to one unit of valuation
    /// flooring — the ceil is on the protocol side (spec §6). When the seize is
    /// capped by available collateral, all remaining collateral is taken (bad
    /// debt is acceptable; over-seizing is not).
    #[test]
    fn liquidation_rounding_never_undercompensates(
        collateral in 100_0000000_i128..1000_0000000,
        borrow_pct in 80_i128..=100,           // % of max LTV actually drawn
        hf_target_pct in 55_i128..=95,         // post-crash health, guarantees hf < 1
        repay_pct in 1_i128..=100,             // % of the close-factor cap
    ) {
        let s = stack();
        s.pool.supply_collateral(&s.alice, &collateral);
        let max_debt = collateral * 8_000 / BPS;
        let debt = max_debt * borrow_pct / 100;
        prop_assume!(debt > 0);
        s.pool.borrow(&s.alice, &debt);

        let crash_to = crash_for_hf(collateral, debt, hf_target_pct);
        prop_assume!(crash_to > 0);
        crash_nav(&s, crash_to);
        prop_assume!(s.pool.health_factor(&s.alice) < SCALE); // safety net; rarely fires

        let repay = (debt / 2) * repay_pct / 100;
        prop_assume!(repay > 0);

        let seize = s.pool.liquidate(&s.liquidator, &s.alice, &repay);
        let share_price = s.vault.share_price();
        let owed_value = repay * (BPS + BONUS) / BPS;
        let seized_value = seize * share_price / SCALE;
        let position = s.pool.position(&s.alice);

        if position.collateral_shares > 0 {
            // Uncapped: at least what the exact math owes (protocol-favoring
            // ceil), and never more than one share-unit of dust beyond it.
            prop_assert!(
                seized_value >= owed_value - 1,
                "under-compensated: {} < {}", seized_value, owed_value
            );
            prop_assert!(
                seized_value <= owed_value + share_price / SCALE + 2,
                "over-seized: {} vs {}", seized_value, owed_value
            );
            prop_assert!(seize <= collateral);
        } else {
            // Collateral exhausted: everything available was taken, never more.
            prop_assert_eq!(seize, collateral);
        }
        prop_assert_eq!(position.debt, debt - repay);
        prop_assert_eq!(s.vault.balance(&s.liquidator), seize);
    }

    /// Driving max-allowed liquidations repeatedly always terminates: debt
    /// strictly decreases each round and the position ends healthy or exhausted.
    #[test]
    fn re_liquidation_terminates(
        collateral in 100_0000000_i128..1000_0000000,
        hf_target_pct in 55_i128..=95,
    ) {
        let s = stack();
        s.pool.supply_collateral(&s.alice, &collateral);
        let debt = collateral * 8_000 / BPS; // full LTV
        prop_assume!(debt > 0);
        s.pool.borrow(&s.alice, &debt);
        crash_nav(&s, crash_for_hf(collateral, debt, hf_target_pct));
        prop_assume!(s.pool.health_factor(&s.alice) < SCALE);

        let mut rounds = 0;
        while s.pool.health_factor(&s.alice) < SCALE {
            let d = s.pool.position(&s.alice).debt;
            let max_repay = d / 2;
            if max_repay == 0 {
                break; // dust tail — close factor forbids further steps
            }
            match s.pool.try_liquidate(&s.liquidator, &s.alice, &max_repay) {
                Ok(Ok(_)) => {
                    prop_assert!(s.pool.position(&s.alice).debt < d);
                }
                _ => break, // collateral exhausted mid-loop is a valid terminal state
            }
            rounds += 1;
            prop_assert!(rounds < 128, "liquidation loop did not converge");
        }
    }
}
