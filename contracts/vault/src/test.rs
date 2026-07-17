#![cfg(test)]
use super::*;
use mock_oracle::{MockOracle, MockOracleClient};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use soroban_sdk::testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{symbol_short, Address, Env, IntoVal, Symbol};

const LEOD: Symbol = symbol_short!("LEOD");
/// NAV points from the C8 golden set, quoted at the mock's 14 decimals.
const NAV14_1_0000: i128 = 100_000_000_000_000;
const NAV14_1_0209: i128 = 102_090_000_000_000;
const NAV14_1_0409: i128 = 104_090_000_000_000;
const CAP: i128 = 10_000_000_000_000_000; // 1e9 units at 7 dec

pub struct Setup {
    pub e: Env,
    pub vault: VaultClient<'static>,
    pub mock: MockOracleClient<'static>,
    pub underlying: TokenClient<'static>,
    pub underlying_admin: StellarAssetClient<'static>,
    pub admin: Address,
}

/// Full stack: SAC underlying (7 dec) + mock feed (14 dec) + adapter + vault.
pub fn setup(nav14: i128) -> Setup {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|l| {
        l.timestamp = 1_000;
        l.sequence_number = 100;
    });
    let admin = Address::generate(&e);

    let sac = e.register_stellar_asset_contract_v2(admin.clone());
    let underlying = TokenClient::new(&e, &sac.address());
    let underlying_admin = StellarAssetClient::new(&e, &sac.address());

    let mock_id = e.register(MockOracle, ());
    let mock = MockOracleClient::new(&e, &mock_id);
    mock.init(&admin, &14);
    mock.set_price(&LEOD, &nav14, &1_000);

    let adapter_id = e.register(OracleAdapter, ());
    let adapter = OracleAdapterClient::new(&e, &adapter_id);
    adapter.init(&admin);
    adapter.configure_feed(&LEOD, &mock_id, &14);

    let vault_id = e.register(Vault, ());
    let vault = VaultClient::new(&e, &vault_id);
    vault.init(&admin, &sac.address(), &adapter_id, &LEOD, &CAP);

    Setup {
        e,
        vault,
        mock,
        underlying,
        underlying_admin,
        admin,
    }
}

fn funded_user(s: &Setup, amount: i128) -> Address {
    let user = Address::generate(&s.e);
    s.underlying_admin.mint(&user, &amount);
    user
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

#[test]
fn init_sets_config_and_rejects_reinit() {
    let s = setup(NAV14_1_0209);
    assert_eq!(s.vault.admin(), s.admin);
    assert_eq!(s.vault.cap(), CAP);
    assert!(!s.vault.is_paused());
    assert_eq!(s.vault.asset_id(), LEOD);
    assert_eq!(s.vault.decimals(), 7);
    assert_eq!(s.vault.total_shares(), 0);
    let other = Address::generate(&s.e);
    assert_eq!(
        s.vault
            .try_init(&other, &other, &other, &LEOD, &1)
            .unwrap_err(),
        Ok(Error::AlreadyInitialized)
    );
}

#[test]
fn uninitialized_vault_fails_typed() {
    let e = Env::default();
    e.mock_all_auths();
    let id = e.register(Vault, ());
    let client = VaultClient::new(&e, &id);
    let who = Address::generate(&e);
    assert_eq!(
        client.try_deposit(&who, &1).unwrap_err(),
        Ok(Error::NotInitialized)
    );
    assert_eq!(
        client.try_withdraw(&who, &1).unwrap_err(),
        Ok(Error::NotInitialized)
    );
}

// ── Deposit math (value-consistent legs, DECISIONS.md #3) ──────────────────────

#[test]
fn first_deposit_mints_value_scaled_shares() {
    let s = setup(NAV14_1_0209);
    let alice = funded_user(&s, 100_0000000);
    let shares = s.vault.deposit(&alice, &100_0000000);
    // value_in = 100.0000000 × 1.0209 = 102.0900000 → first mint is 1:1 on value.
    assert_eq!(shares, 102_0900000);
    assert_eq!(s.vault.balance(&alice), shares);
    assert_eq!(s.vault.total_shares(), shares);
    assert_eq!(s.underlying.balance(&s.vault.address), 100_0000000);
}

#[test]
fn second_depositor_after_nav_rise_is_not_diluted() {
    let s = setup(NAV14_1_0209);
    let alice = funded_user(&s, 100_0000000);
    let bob = funded_user(&s, 100_0000000);
    s.vault.deposit(&alice, &100_0000000);

    // NAV ticks 1.0209 → 1.0409 (~196 bps, inside the deviation bound).
    s.mock.set_price(&LEOD, &NAV14_1_0409, &1_000);
    let bob_shares = s.vault.deposit(&bob, &100_0000000);

    // Bob's claim right after depositing ≈ his contributed value (rounding dust only).
    let bob_value = s.vault.share_price() * bob_shares / SCALE;
    let contributed = 100_0000000_i128 * 1_0409 / 10_000;
    assert!(bob_value <= contributed);
    assert!(
        contributed - bob_value <= 2,
        "bob diluted: {bob_value} vs {contributed}"
    );

    // Alice's claim grew with NAV: 102.09 shares now worth ~104.09 quote units.
    let alice_value = s.vault.share_price() * s.vault.balance(&alice) / SCALE;
    assert!(alice_value >= 104_0899000, "alice value {alice_value}");
}

#[test]
fn deposit_uses_balance_diff_not_caller_amount() {
    let s = setup(NAV14_1_0000);
    let alice = funded_user(&s, 50_0000000);
    // A fee-less SAC delivers the full amount; the invariant here is that the
    // accounted value comes from the measured diff (event carries `received`).
    let shares = s.vault.deposit(&alice, &50_0000000);
    assert_eq!(shares, 50_0000000);
    assert_eq!(s.underlying.balance(&alice), 0);
}

#[test]
fn dust_deposit_one_stroop() {
    let s = setup(NAV14_1_0209);
    let alice = funded_user(&s, 1);
    // value_in = floor(1 × 1.0209) = 1 → 1 share on an empty vault.
    assert_eq!(s.vault.deposit(&alice, &1), 1);
}

#[test]
fn deposit_rejects_zero_negative_and_paused_and_cap() {
    let s = setup(NAV14_1_0000);
    let alice = funded_user(&s, CAP + 1);
    assert_eq!(
        s.vault.try_deposit(&alice, &0).unwrap_err(),
        Ok(Error::ZeroAmount)
    );
    assert_eq!(
        s.vault.try_deposit(&alice, &-5).unwrap_err(),
        Ok(Error::ZeroAmount)
    );
    // Cap edge: exactly at cap passes…
    s.vault.deposit(&alice, &CAP);
    // …one stroop above fails.
    assert_eq!(
        s.vault.try_deposit(&alice, &1).unwrap_err(),
        Ok(Error::CapExceeded)
    );
    s.vault.pause();
    assert_eq!(
        s.vault.try_deposit(&alice, &1).unwrap_err(),
        Ok(Error::Paused)
    );
}

// ── Withdraw math ──────────────────────────────────────────────────────────────

#[test]
fn round_trip_returns_leq_deposited() {
    let s = setup(NAV14_1_0209);
    let alice = funded_user(&s, 100_0000000);
    let shares = s.vault.deposit(&alice, &100_0000000);
    let out = s.vault.withdraw(&alice, &shares);
    assert!(out <= 100_0000000, "round trip must never profit: {out}");
    assert!(out >= 100_0000000 - 2, "excessive rounding loss: {out}");
    assert_eq!(s.vault.balance(&alice), 0);
    assert_eq!(s.vault.total_shares(), 0);
}

#[test]
fn rebase_tick_then_withdraw_all_captures_growth() {
    let s = setup(NAV14_1_0000);
    let alice = funded_user(&s, 100_0000000);
    let shares = s.vault.deposit(&alice, &100_0000000);
    // Weekly rebase: +0.19% balance growth minted straight to the vault.
    s.underlying_admin.mint(&s.vault.address, &1900000);
    let out = s.vault.withdraw(&alice, &shares);
    assert!(
        out > 100_0000000,
        "rebase growth must reach the holder: {out}"
    );
    assert!(out <= 100_1900000);
    assert!(out >= 100_1899990, "growth lost to rounding: {out}");
}

#[test]
fn withdraw_rejects_zero_and_over_balance() {
    let s = setup(NAV14_1_0000);
    let alice = funded_user(&s, 10_0000000);
    let shares = s.vault.deposit(&alice, &10_0000000);
    assert_eq!(
        s.vault.try_withdraw(&alice, &0).unwrap_err(),
        Ok(Error::ZeroAmount)
    );
    assert_eq!(
        s.vault.try_withdraw(&alice, &(shares + 1)).unwrap_err(),
        Ok(Error::InsufficientShares)
    );
}

#[test]
fn withdraw_works_while_paused() {
    let s = setup(NAV14_1_0000);
    let alice = funded_user(&s, 10_0000000);
    let shares = s.vault.deposit(&alice, &10_0000000);
    s.vault.pause();
    // Exits are never pausable (CLAUDE.md non-negotiable).
    let out = s.vault.withdraw(&alice, &shares);
    assert!(out > 0);
}

// ── Oracle dependency (fail-closed) ────────────────────────────────────────────

#[test]
fn oracle_failure_halts_pricing_dependent_ops() {
    let s = setup(NAV14_1_0000);
    let alice = funded_user(&s, 20_0000000);
    let shares = s.vault.deposit(&alice, &10_0000000);
    // Feed goes stale (>25h behind).
    s.e.ledger().with_mut(|l| l.timestamp = 1_000 + 90_001);
    assert_eq!(
        s.vault.try_deposit(&alice, &1_0000000).unwrap_err(),
        Ok(Error::OracleFailure)
    );
    assert_eq!(
        s.vault.try_withdraw(&alice, &shares).unwrap_err(),
        Ok(Error::OracleFailure)
    );
    assert_eq!(
        s.vault.try_share_price().unwrap_err(),
        Ok(Error::OracleFailure)
    );
    // Fresh price → operations resume.
    s.mock.set_price(&LEOD, &NAV14_1_0000, &(1_000 + 90_001));
    assert!(s.vault.withdraw(&alice, &shares) > 0);
}

// ── share_price & donations ────────────────────────────────────────────────────

#[test]
fn empty_vault_share_price_is_one() {
    let s = setup(NAV14_1_0209);
    assert_eq!(s.vault.share_price(), SCALE);
}

#[test]
fn nav_tick_raises_share_price() {
    let s = setup(NAV14_1_0209);
    let alice = funded_user(&s, 100_0000000);
    s.vault.deposit(&alice, &100_0000000);
    let p0 = s.vault.share_price();
    s.mock.set_price(&LEOD, &NAV14_1_0409, &1_000);
    let p1 = s.vault.share_price();
    assert!(p1 > p0, "NAV accrual must raise share_price: {p0} → {p1}");
}

#[test]
fn donation_raises_share_price_and_mints_nothing() {
    let s = setup(NAV14_1_0000);
    let alice = funded_user(&s, 100_0000000);
    s.vault.deposit(&alice, &100_0000000);
    let p0 = s.vault.share_price();
    let s0 = s.vault.total_shares();

    let donor = funded_user(&s, 10_0000000);
    s.underlying.transfer(&donor, &s.vault.address, &10_0000000);

    assert!(s.vault.share_price() > p0);
    assert_eq!(s.vault.total_shares(), s0);
}

#[test]
fn inflation_attack_spec_scenario_loss_below_1e6th() {
    // Spec §3 scenario: 1-stroop mint + donation, then the victim's 1e9 deposit.
    // The strict <1e-6 relative-loss bound holds for donations up to ~1e6 stroops
    // (DECISIONS.md #3); larger donations are covered by the test below.
    let s = setup(NAV14_1_0000);
    let donation: i128 = 1_000_000;
    let attacker = funded_user(&s, donation + 1);
    let victim = funded_user(&s, 1_000_000_000);

    s.vault.deposit(&attacker, &1);
    s.underlying
        .transfer(&attacker, &s.vault.address, &donation);

    let victim_shares = s.vault.deposit(&victim, &1_000_000_000);
    assert!(victim_shares > 0, "victim must not be zeroed out");

    let victim_value = s.vault.share_price() * victim_shares / SCALE;
    let deposited: i128 = 1_000_000_000;
    let loss = deposited - victim_value;
    assert!(
        loss * 1_000_000 < deposited,
        "victim lost {loss} of {deposited} — inflation attack profitable"
    );
}

#[test]
fn inflation_attack_with_huge_donation_costs_the_attacker() {
    let s = setup(NAV14_1_0000);
    let donation: i128 = 1_000_000_000_000_000; // 1e8 units
    let attacker = funded_user(&s, donation + 1);
    let victim = funded_user(&s, 10_0000000);

    s.vault.deposit(&attacker, &1);
    s.underlying
        .transfer(&attacker, &s.vault.address, &donation);

    // The victim's small deposit would mint zero shares — it must REVERT,
    // never silently donate to the attacker.
    assert_eq!(
        s.vault.try_deposit(&victim, &10_0000000).unwrap_err(),
        Ok(Error::ZeroAmount)
    );
    assert_eq!(s.underlying.balance(&victim), 10_0000000);

    // And the attacker's own claim is a tiny fraction of the donation:
    // the virtual shares absorb it — pure loss for the attacker.
    let attacker_value = s.vault.share_price() * s.vault.balance(&attacker) / SCALE;
    assert!(
        attacker_value * 100 < donation,
        "attacker recovered {attacker_value} of {donation}"
    );
}

// ── SEP-41 surface ─────────────────────────────────────────────────────────────

#[test]
fn transfer_moves_shares_and_conserves_supply() {
    let s = setup(NAV14_1_0000);
    let alice = funded_user(&s, 10_0000000);
    let bob = Address::generate(&s.e);
    let shares = s.vault.deposit(&alice, &10_0000000);
    s.vault.transfer(&alice, &bob, &4_0000000);
    assert_eq!(s.vault.balance(&alice), shares - 4_0000000);
    assert_eq!(s.vault.balance(&bob), 4_0000000);
    assert_eq!(s.vault.total_shares(), shares);
    assert_eq!(
        s.vault.try_transfer(&alice, &bob, &shares).unwrap_err(),
        Ok(Error::InsufficientShares)
    );
    assert_eq!(
        s.vault.try_transfer(&alice, &bob, &-1).unwrap_err(),
        Ok(Error::InvalidAmount)
    );
}

#[test]
fn approve_allowance_transfer_from_lifecycle() {
    let s = setup(NAV14_1_0000);
    let alice = funded_user(&s, 10_0000000);
    let spender = Address::generate(&s.e);
    let dest = Address::generate(&s.e);
    s.vault.deposit(&alice, &10_0000000);

    s.vault.approve(&alice, &spender, &5_0000000, &200);
    assert_eq!(s.vault.allowance(&alice, &spender), 5_0000000);

    s.vault.transfer_from(&spender, &alice, &dest, &2_0000000);
    assert_eq!(s.vault.allowance(&alice, &spender), 3_0000000);
    assert_eq!(s.vault.balance(&dest), 2_0000000);

    assert_eq!(
        s.vault
            .try_transfer_from(&spender, &alice, &dest, &4_0000000)
            .unwrap_err(),
        Ok(Error::InsufficientAllowance)
    );

    // Expiry: past the live_until ledger the allowance reads 0 and cannot spend.
    s.e.ledger().with_mut(|l| l.sequence_number = 201);
    assert_eq!(s.vault.allowance(&alice, &spender), 0);
    assert_eq!(
        s.vault
            .try_transfer_from(&spender, &alice, &dest, &1)
            .unwrap_err(),
        Ok(Error::InsufficientAllowance)
    );
}

#[test]
fn approve_validations() {
    let s = setup(NAV14_1_0000);
    let alice = Address::generate(&s.e);
    let spender = Address::generate(&s.e);
    assert_eq!(
        s.vault
            .try_approve(&alice, &spender, &-1, &200)
            .unwrap_err(),
        Ok(Error::InvalidAmount)
    );
    // live_until below the current ledger (100) is invalid for a non-zero amount…
    assert_eq!(
        s.vault.try_approve(&alice, &spender, &1, &99).unwrap_err(),
        Ok(Error::InvalidExpiration)
    );
    // …but amount = 0 clears regardless of expiration.
    s.vault.approve(&alice, &spender, &0, &0);
    assert_eq!(s.vault.allowance(&alice, &spender), 0);
}

#[test]
fn token_metadata() {
    let s = setup(NAV14_1_0000);
    assert_eq!(s.vault.decimals(), 7);
    assert_eq!(s.vault.name(), String::from_str(&s.e, "Leontief Share"));
    assert_eq!(s.vault.symbol(), String::from_str(&s.e, "ldSHARE"));
}

// ── Auth ───────────────────────────────────────────────────────────────────────

#[test]
fn user_ops_require_auth_of_from() {
    let s = setup(NAV14_1_0000);
    let alice = funded_user(&s, 10_0000000);
    s.vault.deposit(&alice, &5_0000000);
    s.e.set_auths(&[]);
    assert!(s.vault.try_deposit(&alice, &1).is_err());
    assert!(s.vault.try_withdraw(&alice, &1).is_err());
    assert!(s.vault.try_transfer(&alice, &s.admin, &1).is_err());
    assert!(s.vault.try_approve(&alice, &s.admin, &1, &200).is_err());
}

#[test]
fn deposit_auth_cannot_be_replayed_for_other_users() {
    let s = setup(NAV14_1_0000);
    let alice = funded_user(&s, 10_0000000);
    let mallory = funded_user(&s, 10_0000000);
    // Only alice signs; a call claiming to act for mallory must fail.
    s.e.set_auths(&[]);
    s.e.mock_auths(&[MockAuth {
        address: &alice,
        invoke: &MockAuthInvoke {
            contract: &s.vault.address,
            fn_name: "deposit",
            args: (alice.clone(), 5_0000000_i128).into_val(&s.e),
            sub_invokes: &[],
        },
    }]);
    assert!(s.vault.try_deposit(&mallory, &5_0000000).is_err());
}

#[test]
fn admin_ops_require_admin_auth() {
    let s = setup(NAV14_1_0000);
    s.e.set_auths(&[]);
    assert!(s.vault.try_set_cap(&1).is_err());
    assert!(s.vault.try_set_oracle(&s.admin).is_err());
    assert!(s.vault.try_pause().is_err());
    assert!(s.vault.try_unpause().is_err());
    assert!(s.vault.try_transfer_admin(&s.admin).is_err());
}

#[test]
fn two_step_admin_transfer() {
    let s = setup(NAV14_1_0000);
    let new_admin = Address::generate(&s.e);
    // Accept without a proposal fails.
    assert_eq!(
        s.vault.try_accept_admin().unwrap_err(),
        Ok(Error::Unauthorized)
    );
    s.vault.transfer_admin(&new_admin);
    // Old admin still in charge until acceptance.
    assert_eq!(s.vault.admin(), s.admin);
    s.vault.accept_admin();
    assert_eq!(s.vault.admin(), new_admin);
    // Pending slot is cleared.
    assert_eq!(
        s.vault.try_accept_admin().unwrap_err(),
        Ok(Error::Unauthorized)
    );
}

// ── Admin params ───────────────────────────────────────────────────────────────

#[test]
fn set_cap_validates_and_applies() {
    let s = setup(NAV14_1_0000);
    assert_eq!(
        s.vault.try_set_cap(&-1).unwrap_err(),
        Ok(Error::InvalidAmount)
    );
    s.vault.set_cap(&5_0000000);
    let alice = funded_user(&s, 10_0000000);
    assert_eq!(
        s.vault.try_deposit(&alice, &5_0000001).unwrap_err(),
        Ok(Error::CapExceeded)
    );
    assert!(s.vault.deposit(&alice, &5_0000000) > 0);
}
