#![cfg(test)]
use super::*;
use mock_oracle::{MockOracle, MockOracleClient};
use soroban_sdk::testutils::{Address as _, Events, Ledger};
use soroban_sdk::{map, symbol_short, vec, Address, Env, IntoVal, Symbol};

const LEOD: Symbol = symbol_short!("LEOD");
/// 1.0 at SCALE (10^12).
const ONE: i128 = 1_000_000_000_000;

struct Setup {
    e: Env,
    adapter: OracleAdapterClient<'static>,
    mock: MockOracleClient<'static>,
}

/// Mock feed at `source_decimals`, LEOD configured, ledger time at `now`.
fn setup(source_decimals: u32, now: u64) -> Setup {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|l| l.timestamp = now);
    let admin = Address::generate(&e);

    let mock_id = e.register(MockOracle, ());
    let mock = MockOracleClient::new(&e, &mock_id);
    mock.init(&admin, &source_decimals);

    let adapter_id = e.register(OracleAdapter, ());
    let adapter = OracleAdapterClient::new(&e, &adapter_id);
    adapter.init(&admin);
    adapter.configure_feed(&LEOD, &mock_id, &source_decimals);

    Setup { e, adapter, mock }
}

// ── Happy paths & normalization ────────────────────────────────────────────────

#[test]
fn fresh_feed_passes_and_normalizes_14_to_12() {
    let s = setup(14, 1_000);
    // 1.0209 at 14 decimals → 1.0209 at 12 decimals.
    s.mock.set_price(&LEOD, &102_090_000_000_000, &1_000);
    assert_eq!(
        s.adapter.get_nav(&LEOD),
        NavData {
            nav: 1_020_900_000_000,
            ts: 1_000
        }
    );
}

#[test]
fn normalizes_7_to_12() {
    let s = setup(7, 1_000);
    // 1.0209 at 7 decimals (golden C8 NAV point).
    s.mock.set_price(&LEOD, &10_209_000, &1_000);
    assert_eq!(s.adapter.get_nav(&LEOD).nav, 1_020_900_000_000);
}

#[test]
fn normalizes_12_to_12_identity() {
    let s = setup(12, 1_000);
    s.mock.set_price(&LEOD, &ONE, &1_000);
    assert_eq!(s.adapter.get_nav(&LEOD).nav, ONE);
}

#[test]
fn normalization_floors_when_scaling_down() {
    let s = setup(14, 1_000);
    // …99 in the two truncated places floors away.
    s.mock.set_price(&LEOD, &102_090_000_000_099, &1_000);
    assert_eq!(s.adapter.get_nav(&LEOD).nav, 1_020_900_000_000);
}

#[test]
fn get_nav_stores_last_accepted() {
    let s = setup(12, 1_000);
    assert_eq!(s.adapter.last_accepted(&LEOD), None);
    s.mock.set_price(&LEOD, &ONE, &900);
    s.adapter.get_nav(&LEOD);
    assert_eq!(
        s.adapter.last_accepted(&LEOD),
        Some(NavData { nav: ONE, ts: 900 })
    );
}

// ── Staleness (default max_age = 90_000 s) ─────────────────────────────────────

#[test]
fn age_exact_boundary_passes() {
    let s = setup(12, 100_000);
    s.mock.set_price(&LEOD, &ONE, &10_000); // age = 90_000 = max_age
    assert_eq!(s.adapter.get_nav(&LEOD).nav, ONE);
}

#[test]
fn age_boundary_plus_one_is_stale() {
    let s = setup(12, 100_001);
    s.mock.set_price(&LEOD, &ONE, &10_000); // age = 90_001
    assert_eq!(s.adapter.try_get_nav(&LEOD), Err(Ok(Error::StalePrice)));
}

#[test]
fn future_timestamp_fails_closed() {
    let s = setup(12, 1_000);
    s.mock.set_price(&LEOD, &ONE, &1_001);
    assert_eq!(s.adapter.try_get_nav(&LEOD), Err(Ok(Error::OracleFailure)));
}

#[test]
fn tightened_max_age_is_enforced() {
    let s = setup(12, 100_000);
    s.mock.set_price(&LEOD, &ONE, &99_000); // age 1_000
    s.adapter.set_bounds(&LEOD, &999, &200);
    assert_eq!(s.adapter.try_get_nav(&LEOD), Err(Ok(Error::StalePrice)));
    s.adapter.set_bounds(&LEOD, &1_000, &200);
    assert_eq!(s.adapter.get_nav(&LEOD).nav, ONE);
}

// ── Deviation (default max_dev = 200 bps per update) ───────────────────────────

#[test]
fn deviation_exact_boundary_passes() {
    let s = setup(12, 1_000);
    s.mock.set_price(&LEOD, &ONE, &1_000);
    s.adapter.get_nav(&LEOD); // last_accepted = 1.0
    let exactly_200_bps = ONE + ONE / 10_000 * 200; // 1.02
    s.mock.set_price(&LEOD, &exactly_200_bps, &1_000);
    assert_eq!(s.adapter.get_nav(&LEOD).nav, exactly_200_bps);
}

#[test]
fn deviation_over_boundary_fails_both_directions() {
    let s = setup(12, 1_000);
    s.mock.set_price(&LEOD, &ONE, &1_000);
    s.adapter.get_nav(&LEOD);

    let over_up = ONE + ONE / 10_000 * 200 + 1;
    s.mock.set_price(&LEOD, &over_up, &1_000);
    assert_eq!(
        s.adapter.try_get_nav(&LEOD),
        Err(Ok(Error::DeviationExceeded))
    );

    let over_down = ONE - ONE / 10_000 * 200 - 1;
    s.mock.set_price(&LEOD, &over_down, &1_000);
    assert_eq!(
        s.adapter.try_get_nav(&LEOD),
        Err(Ok(Error::DeviationExceeded))
    );
}

#[test]
fn rejected_update_does_not_move_last_accepted() {
    let s = setup(12, 1_000);
    s.mock.set_price(&LEOD, &ONE, &1_000);
    s.adapter.get_nav(&LEOD);
    s.mock.set_price(&LEOD, &(ONE * 2), &1_000);
    assert!(s.adapter.try_get_nav(&LEOD).is_err());
    // The breaker anchor is still the last *accepted* value.
    assert_eq!(s.adapter.last_accepted(&LEOD).unwrap().nav, ONE);
}

// ── Fail-closed source anomalies ───────────────────────────────────────────────

#[test]
fn missing_price_is_oracle_failure() {
    let s = setup(12, 1_000);
    assert_eq!(s.adapter.try_get_nav(&LEOD), Err(Ok(Error::OracleFailure)));
}

#[test]
fn zero_and_negative_prices_are_oracle_failure() {
    let s = setup(12, 1_000);
    s.mock.set_price(&LEOD, &0, &1_000);
    assert_eq!(s.adapter.try_get_nav(&LEOD), Err(Ok(Error::OracleFailure)));
    s.mock.set_price(&LEOD, &-1, &1_000);
    assert_eq!(s.adapter.try_get_nav(&LEOD), Err(Ok(Error::OracleFailure)));
}

#[test]
fn unconfigured_asset_is_not_configured() {
    let s = setup(12, 1_000);
    assert_eq!(
        s.adapter.try_get_nav(&symbol_short!("NOPE")),
        Err(Ok(Error::NotConfigured))
    );
}

#[test]
fn normalization_overflow_is_math_overflow() {
    let s = setup(4, 1_000);
    // price · 10^8 overflows i128.
    s.mock.set_price(&LEOD, &(i128::MAX / 10), &1_000);
    assert_eq!(s.adapter.try_get_nav(&LEOD), Err(Ok(Error::MathOverflow)));
}

// ── Override path ──────────────────────────────────────────────────────────────

#[test]
fn override_rearms_after_deviation_halt() {
    let s = setup(12, 1_000);
    s.mock.set_price(&LEOD, &ONE, &1_000);
    s.adapter.get_nav(&LEOD);

    // Feed gaps 5% — halted.
    let gapped = ONE + ONE / 20;
    s.mock.set_price(&LEOD, &gapped, &1_000);
    assert_eq!(
        s.adapter.try_get_nav(&LEOD),
        Err(Ok(Error::DeviationExceeded))
    );

    // Human investigates, accepts the new level; the loud event fires.
    s.adapter.accept_override(&LEOD, &gapped);
    let data: soroban_sdk::Map<Symbol, soroban_sdk::Val> = map![
        &s.e,
        (symbol_short!("nav"), gapped.into_val(&s.e)),
        (symbol_short!("ts"), 1_000_u64.into_val(&s.e))
    ];
    assert_eq!(
        s.e.events().all(),
        vec![
            &s.e,
            (
                s.adapter.address.clone(),
                (Symbol::new(&s.e, "override_accepted"), LEOD).into_val(&s.e),
                data.into_val(&s.e)
            )
        ]
    );

    // Re-armed: the same feed value now passes.
    assert_eq!(s.adapter.get_nav(&LEOD).nav, gapped);
}

#[test]
fn override_rejects_nonpositive_and_unconfigured() {
    let s = setup(12, 1_000);
    assert_eq!(
        s.adapter.try_accept_override(&LEOD, &0),
        Err(Ok(Error::InvalidConfig))
    );
    assert_eq!(
        s.adapter.try_accept_override(&symbol_short!("NOPE"), &ONE),
        Err(Ok(Error::NotConfigured))
    );
}

// ── Config & auth ──────────────────────────────────────────────────────────────

#[test]
fn configure_feed_clears_last_accepted() {
    let s = setup(12, 1_000);
    s.mock.set_price(&LEOD, &ONE, &1_000);
    s.adapter.get_nav(&LEOD);
    assert!(s.adapter.last_accepted(&LEOD).is_some());
    s.adapter.configure_feed(&LEOD, &s.mock.address, &12);
    assert_eq!(s.adapter.last_accepted(&LEOD), None);
}

#[test]
fn configure_feed_rejects_absurd_decimals() {
    let s = setup(12, 1_000);
    assert_eq!(
        s.adapter.try_configure_feed(&LEOD, &s.mock.address, &39),
        Err(Ok(Error::InvalidConfig))
    );
}

#[test]
fn set_bounds_requires_configured_feed() {
    let s = setup(12, 1_000);
    assert_eq!(
        s.adapter.try_set_bounds(&symbol_short!("NOPE"), &1, &1),
        Err(Ok(Error::NotConfigured))
    );
}

#[test]
fn admin_fns_require_auth() {
    let s = setup(12, 1_000);
    s.e.set_auths(&[]);
    assert!(s
        .adapter
        .try_configure_feed(&LEOD, &s.mock.address, &12)
        .is_err());
    assert!(s.adapter.try_set_bounds(&LEOD, &1, &1).is_err());
    assert!(s.adapter.try_accept_override(&LEOD, &ONE).is_err());
}

#[test]
fn init_twice_rejected_and_uninit_fails_typed() {
    let e = Env::default();
    e.mock_all_auths();
    let id = e.register(OracleAdapter, ());
    let client = OracleAdapterClient::new(&e, &id);
    let admin = Address::generate(&e);
    assert_eq!(
        client.try_configure_feed(&LEOD, &admin, &12),
        Err(Ok(Error::NotInitialized))
    );
    client.init(&admin);
    assert_eq!(client.try_init(&admin), Err(Ok(Error::AlreadyInitialized)));
}
