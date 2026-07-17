//! Golden-vector conformance (prompt C8): load the committed
//! `tests/fixtures/golden.json` and assert the REAL contracts reproduce every
//! value byte-for-byte. If `golden_gen.py` and the contracts ever disagree, this
//! fails — the fixture is the audit-bank reference, not decoration.

use leontief_integration::{World, NAV_1_0000, NAV_1_0409, SCALE};
use serde_json::Value;

fn golden() -> Value {
    serde_json::from_str(include_str!("../fixtures/golden.json")).expect("golden.json parses")
}

/// Look up a vector by name in a section.
fn vec_by_name<'a>(doc: &'a Value, section: &str, name: &str) -> &'a Value {
    doc[section]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["name"] == name)
        .unwrap_or_else(|| panic!("missing {section} vector {name}"))
}

fn i128_of(v: &Value, key: &str) -> i128 {
    v[key].as_i64().map(i128::from).unwrap_or_else(|| {
        v[key]
            .as_str()
            .and_then(|s| s.parse().ok())
            .or_else(|| v[key].as_u64().map(i128::from))
            .unwrap_or_else(|| panic!("{key} not an integer: {:?}", v[key]))
    })
}

/// A vault authorized to hold LEOD, empty, with the given underlying already
/// mintable to `who`.
fn ready_vault() -> World {
    let w = World::new();
    w.authorize_for_leod(&w.vault.address);
    w
}

// ── Vault vectors ──────────────────────────────────────────────────────────────

#[test]
fn golden_vault_first_and_second_deposit() {
    let doc = golden();
    let w = ready_vault();

    // Vector 1: first deposit @ NAV 1.0209.
    let g1 = vec_by_name(&doc, "vault", "first_deposit_nav_1_0209");
    let s1 = w.vault.deposit(&w.alice, &i128_of(g1, "deposit"));
    assert_eq!(s1, i128_of(g1, "expect_shares"), "first deposit shares");

    // Vector 2: second depositor after NAV → 1.0409 (bob, freshly authorized+funded).
    let g2 = vec_by_name(&doc, "vault", "second_depositor_after_nav_rise");
    w.set_nav(NAV_1_0409);
    w.leod_admin.set_authorized(&w.bob, &true);
    w.leod_admin.mint(&w.bob, &i128_of(g2, "deposit"));
    let s2 = w.vault.deposit(&w.bob, &i128_of(g2, "deposit"));
    assert_eq!(s2, i128_of(g2, "expect_shares"), "second depositor shares");
}

#[test]
fn golden_vault_rebase_then_withdraw() {
    let doc = golden();
    let g = vec_by_name(&doc, "vault", "rebase_then_withdraw_all");
    let w = ready_vault();
    w.set_nav(NAV_1_0000);

    let shares = w.vault.deposit(&w.alice, &i128_of(g, "deposit"));
    assert_eq!(shares, i128_of(g, "shares"));

    // Weekly rebase: mint +0.19% straight to the vault, then withdraw all.
    let growth = i128_of(g, "balance_after_rebase") - i128_of(g, "deposit");
    w.leod_admin.mint(&w.vault.address, &growth);
    let out = w.vault.withdraw(&w.alice, &shares);
    assert_eq!(out, i128_of(g, "expect_withdraw"), "rebase withdraw-all");
}

#[test]
fn golden_vault_dust_and_cap_edge() {
    let doc = golden();

    // Dust: 1 stroop @ NAV 1.0209.
    let gd = vec_by_name(&doc, "vault", "dust_deposit_one_stroop");
    let w = ready_vault();
    let sd = w.vault.deposit(&w.alice, &i128_of(gd, "deposit"));
    assert_eq!(sd, i128_of(gd, "expect_shares"), "dust deposit");

    // Cap edge: deposit exactly to the cap on a fresh vault @ NAV 1.0.
    let gc = vec_by_name(&doc, "vault", "cap_edge_deposit");
    let w2 = World::new();
    w2.authorize_for_leod(&w2.vault.address);
    w2.set_nav(NAV_1_0000);
    w2.vault.set_cap(&i128_of(gc, "cap"));
    // Alice needs enough LEOD for the cap-sized deposit.
    w2.leod_admin.mint(&w2.alice, &i128_of(gc, "cap"));
    let sc = w2.vault.deposit(&w2.alice, &i128_of(gc, "deposit"));
    assert_eq!(sc, i128_of(gc, "expect_shares"), "cap-edge deposit");
}

// ── Pool vectors ───────────────────────────────────────────────────────────────

/// Reproduce the generator's pool model: a vault whose total == the supplied
/// collateral (borrower deposits `shares` LEOD and pledges all of it), so
/// share_price and hf match golden_gen.py exactly.
fn setup_pool_position(shares: i128, debt: i128) -> World {
    let w = World::new();
    w.authorize_for_leod(&w.vault.address);
    w.set_nav(NAV_1_0000);
    // Alice holds 10_000 LEOD from World::new (> any `shares` here); deposit
    // `shares` of it → `shares` shares at NAV 1.0 (1:1 first deposit).
    let minted = w.vault.deposit(&w.alice, &shares);
    assert_eq!(minted, shares, "1:1 at NAV 1.0");
    w.pool.supply_collateral(&w.alice, &shares);
    w.pool.borrow(&w.alice, &debt);
    w
}

#[test]
fn golden_pool_health_factors() {
    let doc = golden();
    let g0 = vec_by_name(&doc, "pool", "hf_nav_1_0000");
    let shares = i128_of(g0, "shares");
    let debt = i128_of(g0, "debt");

    // NAV 1.0 (share_price exactly 1.0 → hf independent of vault size).
    let w = setup_pool_position(shares, debt);
    assert_eq!(w.vault.share_price(), i128_of(g0, "share_price"));
    assert_eq!(
        w.pool.health_factor(&w.alice),
        i128_of(g0, "expect_hf"),
        "hf @ NAV 1.0"
    );

    // NAV 1.02 — exactly +200 bps from the last accepted 1.0 (boundary passes).
    let g1 = vec_by_name(&doc, "pool", "hf_nav_1_0200");
    let w1 = setup_pool_position(shares, debt);
    w1.set_nav(SCALE * 102 / 100 * 100); // 1.02 at 14-dec feed
    assert_eq!(w1.vault.share_price(), i128_of(g1, "share_price"));
    assert_eq!(
        w1.pool.health_factor(&w1.alice),
        i128_of(g1, "expect_hf"),
        "hf @ NAV 1.02"
    );

    // NAV 0.94 — a large drop, applied via the documented override path.
    let g2 = vec_by_name(&doc, "pool", "hf_nav_0_9400");
    let w2 = setup_pool_position(shares, debt);
    w2.crash_nav(SCALE * 94 / 100);
    assert_eq!(w2.vault.share_price(), i128_of(g2, "share_price"));
    assert_eq!(
        w2.pool.health_factor(&w2.alice),
        i128_of(g2, "expect_hf"),
        "hf @ NAV 0.94"
    );
}

#[test]
fn golden_pool_seize_amounts() {
    let doc = golden();
    // Drive a real liquidation at share_price 0.90 and match the seize vector for
    // the max-close-factor repay (200 LEOD): a distressed 500-share / 400-debt
    // position after a crash to 0.90.
    let g = vec_by_name(&doc, "pool", "seize_repay_2000000000");
    let shares = 500_0000000_i128;
    let debt = 400_0000000_i128;
    let w = setup_pool_position(shares, debt);
    w.crash_nav(SCALE * 90 / 100);
    assert_eq!(
        w.vault.share_price(),
        i128_of(g, "share_price"),
        "crashed share_price matches the seize vector"
    );
    assert!(w.pool.health_factor(&w.alice) < SCALE, "liquidatable");

    w.pool.set_whitelist(&w.liquidator, &true);
    let seize = w
        .pool
        .liquidate(&w.liquidator, &w.alice, &i128_of(g, "repay"));
    assert_eq!(seize, i128_of(g, "expect_seize"), "seize @ 500 bps bonus");
}
