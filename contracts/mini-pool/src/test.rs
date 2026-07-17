#![cfg(test)]
use super::*;
use mock_oracle::{MockOracle, MockOracleClient};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{symbol_short, Address, Env, Symbol};
use vault::{Vault, VaultClient};

const LEOD: Symbol = symbol_short!("LEOD");
const POOL_LIQUIDITY: i128 = 10_000_000_000_000; // 1e6 units at 7 dec

pub struct Setup {
    pub e: Env,
    pub pool: MiniPoolClient<'static>,
    pub vault: VaultClient<'static>,
    pub adapter: OracleAdapterClient<'static>,
    pub mock: MockOracleClient<'static>,
    pub usdc: TokenClient<'static>,
    pub usdc_admin: StellarAssetClient<'static>,
    pub alice: Address,
    pub liquidator: Address,
}

/// Full stack at NAV 1.0: LEOD SAC → vault (alice holds shares) → USDC SAC →
/// pool seeded with borrow liquidity, liquidator whitelisted.
pub fn setup() -> Setup {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|l| {
        l.timestamp = 1_000;
        l.sequence_number = 100;
    });
    let admin = Address::generate(&e);

    let leod = e.register_stellar_asset_contract_v2(admin.clone());
    let leod_admin = StellarAssetClient::new(&e, &leod.address());

    let usdc_sac = e.register_stellar_asset_contract_v2(admin.clone());
    let usdc = TokenClient::new(&e, &usdc_sac.address());
    let usdc_admin = StellarAssetClient::new(&e, &usdc_sac.address());

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
    vault.init(&admin, &leod.address(), &adapter_id, &LEOD, &POOL_LIQUIDITY);

    let pool_id = e.register(MiniPool, ());
    let pool = MiniPoolClient::new(&e, &pool_id);
    pool.init(&admin, &vault_id, &usdc_sac.address(), &adapter_id);
    usdc_admin.mint(&pool_id, &POOL_LIQUIDITY);

    // Alice wraps 1000 LEOD at NAV 1.0 → 1000.0000000 shares.
    let alice = Address::generate(&e);
    leod_admin.mint(&alice, &1000_0000000);
    vault.deposit(&alice, &1000_0000000);

    let liquidator = Address::generate(&e);
    usdc_admin.mint(&liquidator, &POOL_LIQUIDITY);
    pool.set_whitelist(&liquidator, &true);

    Setup {
        e,
        pool,
        vault,
        adapter,
        mock,
        usdc,
        usdc_admin,
        alice,
        liquidator,
    }
}

/// Crash the NAV to `target` (SCALE-scaled) through the admin override — the
/// documented re-arm path for moves beyond the per-update deviation bound.
fn crash_nav(s: &mut Setup, target: i128) {
    s.adapter.accept_override(&LEOD, &target);
    s.mock.set_price(&LEOD, &target, &1_000);
}

fn supplied_borrower(s: &Setup, shares: i128, debt: i128) -> Address {
    s.pool.supply_collateral(&s.alice, &shares);
    if debt > 0 {
        s.pool.borrow(&s.alice, &debt);
    }
    s.alice.clone()
}

// ── C5 · supply / borrow / repay / withdraw ────────────────────────────────────

#[test]
fn supply_moves_shares_and_records_position() {
    let s = setup();
    s.pool.supply_collateral(&s.alice, &400_0000000);
    assert_eq!(s.vault.balance(&s.alice), 600_0000000);
    assert_eq!(s.vault.balance(&s.pool.address), 400_0000000);
    assert_eq!(
        s.pool.position(&s.alice),
        Position {
            collateral_shares: 400_0000000,
            debt: 0
        }
    );
}

#[test]
fn golden_health_factors_at_three_nav_points() {
    // 500 shares supplied, 300 USDC debt. At NAV 1.0 (share_price 1.0):
    // coll_value = 500 → hf = 500·0.85/300 = 1.416666666666…
    // These inline values are replaced by tests/fixtures/golden.json in C8.
    // Exact-integer expectations (virtual offset skews share_price by ~2e-9
    // off the raw NAV — see DECISIONS.md #3); recomputed by golden_gen.py in C8.
    let mut s = setup();
    supplied_borrower(&s, 500_0000000, 300_0000000);
    assert_eq!(s.pool.health_factor(&s.alice), 1_416_666_666_666);

    // NAV 1.02 (one accepted 200bps tick): ~1.416666… × 1.02.
    s.mock.set_price(&LEOD, &1_020_000_000_000, &1_000);
    assert_eq!(s.pool.health_factor(&s.alice), 1_444_999_997_000);

    // NAV 0.94: hf ≈ 500·0.94·0.85/300 → still ≥ 1.
    crash_nav(&mut s, 940_000_000_000);
    assert_eq!(s.pool.health_factor(&s.alice), 1_331_666_674_666);
}

#[test]
fn borrow_ltv_boundary_exact_and_plus_one() {
    let s = setup();
    s.pool.supply_collateral(&s.alice, &500_0000000);
    // coll_value = 500.0000000 → max debt = 400.0000000 exactly (80%).
    assert_eq!(
        s.pool.try_borrow(&s.alice, &(400_0000000 + 1)).unwrap_err(),
        Ok(Error::LtvExceeded)
    );
    s.pool.borrow(&s.alice, &400_0000000);
    assert_eq!(s.usdc.balance(&s.alice), 400_0000000);
    assert_eq!(s.pool.position(&s.alice).debt, 400_0000000);
    // Fully drawn: one more stroop fails.
    assert_eq!(
        s.pool.try_borrow(&s.alice, &1).unwrap_err(),
        Ok(Error::LtvExceeded)
    );
}

#[test]
fn borrow_requires_pool_liquidity() {
    let s = setup();
    s.pool.supply_collateral(&s.alice, &500_0000000);
    assert_eq!(
        s.pool
            .try_borrow(&s.alice, &(POOL_LIQUIDITY + 1))
            .unwrap_err(),
        Ok(Error::InsufficientLiquidity)
    );
}

#[test]
fn unsafe_withdraw_reverts_safe_withdraw_passes() {
    let s = setup();
    supplied_borrower(&s, 500_0000000, 300_0000000);
    // Withdrawing 90 shares keeps hf ≥ 1 (410·0.85/300 = 1.161); 200 breaks it
    // (300·0.85/300 = 0.85).
    assert_eq!(
        s.pool
            .try_withdraw_collateral(&s.alice, &200_0000000)
            .unwrap_err(),
        Ok(Error::UnsafeWithdraw)
    );
    s.pool.withdraw_collateral(&s.alice, &90_0000000);
    assert_eq!(s.vault.balance(&s.alice), 590_0000000);
}

#[test]
fn withdraw_more_than_supplied_rejected() {
    let s = setup();
    s.pool.supply_collateral(&s.alice, &100_0000000);
    assert_eq!(
        s.pool
            .try_withdraw_collateral(&s.alice, &100_0000001)
            .unwrap_err(),
        Ok(Error::InsufficientCollateral)
    );
}

#[test]
fn repay_reduces_debt_and_clamps_overpayment() {
    let s = setup();
    supplied_borrower(&s, 500_0000000, 300_0000000);
    s.pool.repay(&s.alice, &100_0000000);
    assert_eq!(s.pool.position(&s.alice).debt, 200_0000000);
    // Overpay: only the outstanding 200 is taken.
    let before = s.usdc.balance(&s.alice);
    s.pool.repay(&s.alice, &250_0000000);
    assert_eq!(s.pool.position(&s.alice).debt, 0);
    assert_eq!(before - s.usdc.balance(&s.alice), 200_0000000);
    // Debt-free: nothing to repay.
    assert_eq!(
        s.pool.try_repay(&s.alice, &1).unwrap_err(),
        Ok(Error::ZeroAmount)
    );
}

#[test]
fn no_debt_health_factor_is_max() {
    let s = setup();
    s.pool.supply_collateral(&s.alice, &100_0000000);
    assert_eq!(s.pool.health_factor(&s.alice), i128::MAX);
}

#[test]
fn repay_works_during_oracle_halt_but_borrow_does_not() {
    let s = setup();
    supplied_borrower(&s, 500_0000000, 300_0000000);
    // Feed goes stale: valuation-dependent ops halt…
    s.e.ledger().with_mut(|l| l.timestamp = 1_000 + 90_001);
    assert_eq!(
        s.pool.try_borrow(&s.alice, &1).unwrap_err(),
        Ok(Error::OracleFailure)
    );
    assert_eq!(
        s.pool.try_withdraw_collateral(&s.alice, &1).unwrap_err(),
        Ok(Error::OracleFailure)
    );
    assert_eq!(
        s.pool
            .try_liquidate(&s.liquidator, &s.alice, &1)
            .unwrap_err(),
        Ok(Error::OracleFailure)
    );
    // …but the exit stays open: repay needs no valuation.
    s.pool.repay(&s.alice, &300_0000000);
    assert_eq!(s.pool.position(&s.alice).debt, 0);
}

#[test]
fn zero_interest_documented_behavior() {
    // 0% APR: debt is identical after arbitrary time passes.
    let s = setup();
    supplied_borrower(&s, 500_0000000, 300_0000000);
    s.e.ledger().with_mut(|l| l.timestamp += 86_400 * 30);
    s.mock.set_price(&LEOD, &SCALE, &(1_000 + 86_400 * 30));
    assert_eq!(s.pool.position(&s.alice).debt, 300_0000000);
}

// ── C6 · permissioned liquidation ──────────────────────────────────────────────

/// Distressed fixture: 500 shares, 400 debt (max LTV), NAV crash to 0.90 →
/// coll_value 450, hf = 450·0.85/400 = 0.95625 < 1.
fn distressed(s: &mut Setup) {
    supplied_borrower(s, 500_0000000, 400_0000000);
    crash_nav(s, 900_000_000_000);
    assert!(s.pool.health_factor(&s.alice) < SCALE);
}

#[test]
fn whitelisted_liquidation_happy_path() {
    let mut s = setup();
    distressed(&mut s);

    let repay = 200_0000000; // exactly debt/2
    let seize = s.pool.liquidate(&s.liquidator, &s.alice, &repay);

    // seize = ceil(210 / 0.90) shares = ceil(233.333…) = 233.3333334 shares
    // (7-dec share units; share_price = 0.90 after the crash).
    let share_price = s.vault.share_price();
    let expected_value = repay * (BPS + LIQ_BONUS_BPS) / BPS; // 210.0000000
    let seized_value = seize * share_price / SCALE;
    assert!(seized_value >= expected_value - 1, "pool under-compensated");
    assert!(
        seized_value <= expected_value + share_price / SCALE + 1,
        "liquidator over-seized: {seized_value} vs {expected_value}"
    );

    let pos = s.pool.position(&s.alice);
    assert_eq!(pos.debt, 200_0000000);
    assert_eq!(pos.collateral_shares, 500_0000000 - seize);
    assert_eq!(s.vault.balance(&s.liquidator), seize);
}

#[test]
fn unwhitelisted_liquidator_rejected() {
    let mut s = setup();
    distressed(&mut s);
    let rando = Address::generate(&s.e);
    s.usdc_admin.mint(&rando, &1000_0000000);
    assert_eq!(
        s.pool
            .try_liquidate(&rando, &s.alice, &100_0000000)
            .unwrap_err(),
        Ok(Error::NotWhitelisted)
    );
    // Revoking the permission closes the door again.
    s.pool.set_whitelist(&s.liquidator, &false);
    assert_eq!(
        s.pool
            .try_liquidate(&s.liquidator, &s.alice, &100_0000000)
            .unwrap_err(),
        Ok(Error::NotWhitelisted)
    );
}

#[test]
fn healthy_position_cannot_be_liquidated() {
    let s = setup();
    supplied_borrower(&s, 500_0000000, 300_0000000);
    assert_eq!(
        s.pool
            .try_liquidate(&s.liquidator, &s.alice, &100_0000000)
            .unwrap_err(),
        Ok(Error::HealthyPosition)
    );
}

#[test]
fn close_factor_caps_single_liquidation() {
    let mut s = setup();
    distressed(&mut s);
    // debt = 400 → max repay = 200; one stroop more is rejected.
    assert_eq!(
        s.pool
            .try_liquidate(&s.liquidator, &s.alice, &(200_0000000 + 1))
            .unwrap_err(),
        Ok(Error::CloseFactorExceeded)
    );
    s.pool.liquidate(&s.liquidator, &s.alice, &200_0000000);
}

#[test]
fn re_liquidation_until_healthy_terminates() {
    let mut s = setup();
    distressed(&mut s);
    let mut rounds = 0;
    loop {
        let hf = s.pool.health_factor(&s.alice);
        if hf >= SCALE {
            break;
        }
        let debt = s.pool.position(&s.alice).debt;
        let max_repay = debt / CLOSE_FACTOR_DIV;
        if max_repay == 0 {
            break; // dust tail: close factor forbids further steps
        }
        s.pool.liquidate(&s.liquidator, &s.alice, &max_repay);
        let after = s.pool.position(&s.alice).debt;
        assert!(after < debt, "debt must strictly decrease");
        rounds += 1;
        assert!(rounds < 64, "liquidation loop did not terminate");
    }
    // The loop ends in bounded rounds — either healthy or dust-stuck, never
    // spinning. (With a 5% bonus each round improves hf, so healthy wins.)
    assert!(s.pool.health_factor(&s.alice) >= SCALE || rounds < 64);
}

#[test]
fn liquidation_validates_amounts() {
    let mut s = setup();
    distressed(&mut s);
    assert_eq!(
        s.pool
            .try_liquidate(&s.liquidator, &s.alice, &0)
            .unwrap_err(),
        Ok(Error::ZeroAmount)
    );
}

// ── Auth & lifecycle ───────────────────────────────────────────────────────────

#[test]
fn every_entry_point_requires_auth() {
    let s = setup();
    s.pool.supply_collateral(&s.alice, &100_0000000);
    s.e.set_auths(&[]);
    assert!(s.pool.try_supply_collateral(&s.alice, &1).is_err());
    assert!(s.pool.try_withdraw_collateral(&s.alice, &1).is_err());
    assert!(s.pool.try_borrow(&s.alice, &1).is_err());
    assert!(s.pool.try_repay(&s.alice, &1).is_err());
    assert!(s.pool.try_liquidate(&s.liquidator, &s.alice, &1).is_err());
    assert!(s.pool.try_set_whitelist(&s.liquidator, &true).is_err());
}

#[test]
fn init_lifecycle_and_typed_errors() {
    let e = Env::default();
    e.mock_all_auths();
    let pool_id = e.register(MiniPool, ());
    let pool = MiniPoolClient::new(&e, &pool_id);
    let who = Address::generate(&e);
    assert_eq!(
        pool.try_supply_collateral(&who, &1).unwrap_err(),
        Ok(Error::NotInitialized)
    );
    pool.init(&who, &who, &who, &who);
    assert_eq!(
        pool.try_init(&who, &who, &who, &who).unwrap_err(),
        Ok(Error::AlreadyInitialized)
    );
}
