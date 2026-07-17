//! The 5-beat SCF demo, mirrored 1:1 as integration tests (spec §8, prompt C7).
//! Each test's doc-comment is its on-screen video caption (the S2 demo kit reads
//! them). `just demo-local` runs exactly these six with pretty output.

use leontief_integration::{World, NAV_1_0409, SCALE};

/// Beat 1 — A restricted bond can't move to a stranger; authorize the vault and the door opens.
#[test]
fn beat_1_restricted_transfer_fails() {
    let w = World::new();

    // LEOD is a real SEP-8 asset: sending it to a non-authorized wallet fails.
    let before = w.leod.balance(&w.alice);
    let res = w.leod.try_transfer(&w.alice, &w.rando, &100_0000000);
    assert!(res.is_err(), "restricted transfer to a stranger must fail");
    assert_eq!(w.leod.balance(&w.alice), before, "no LEOD moved");

    // A deposit also fails while the vault is unauthorized (the vault would have
    // to receive LEOD it isn't allowed to hold).
    assert!(
        w.vault.try_deposit(&w.alice, &100_0000000).is_err(),
        "deposit blocked until the vault is authorized"
    );

    // The issuer authorizes the vault — Leontief's answer to the restriction.
    w.authorize_for_leod(&w.vault.address);
    let shares = w.vault.deposit(&w.alice, &100_0000000);
    assert!(shares > 0, "deposit succeeds once the vault is authorized");
}

/// Beat 2 — Wrap the bond: the vault mints a composable ldLEOD share at live NAV.
#[test]
fn beat_2_wrap_mints_share() {
    let w = World::new();
    w.authorize_for_leod(&w.vault.address);

    // Deposit 100 LEOD at NAV 1.0209 → value 102.09 → 102.09 shares (first mint,
    // 1:1 on value; balance-diff measured, virtual-offset math applied).
    let shares = w.vault.deposit(&w.alice, &100_0000000);
    assert_eq!(shares, 102_0900000);
    assert_eq!(w.vault.balance(&w.alice), shares);
    assert_eq!(w.vault.total_shares(), shares);
    assert_eq!(w.leod.balance(&w.vault.address), 100_0000000);
}

/// Beat 3 — The share moves freely and borrows: transfer ldLEOD, pledge it, draw USDC.
#[test]
fn beat_3_share_moves_and_borrows() {
    let w = World::new();
    w.authorize_for_leod(&w.vault.address);
    let shares = w.vault.deposit(&w.alice, &100_0000000);

    // The SHARE has no transfer restriction (SEP-41) — alice sends half to bob.
    let half = shares / 2;
    w.vault.transfer(&w.alice, &w.bob, &half);
    assert_eq!(w.vault.balance(&w.bob), half);

    // Bob pledges his share and borrows USDC at ≤ 80% LTV.
    w.pool.supply_collateral(&w.bob, &half);
    let coll_value = half * w.vault.share_price() / SCALE;
    let max_borrow = coll_value * 8_000 / 10_000;
    w.pool.borrow(&w.bob, &max_borrow);
    assert_eq!(w.usdc.balance(&w.bob), max_borrow);

    // One stroop over the LTV is rejected.
    assert!(w.pool.try_borrow(&w.bob, &1).is_err(), "LTV cap holds");
}

/// Beat 4 — Yield while pledged: a NAV tick lifts the share price even for locked collateral.
#[test]
fn beat_4_nav_tick_raises_price_while_pledged() {
    let w = World::new();
    w.authorize_for_leod(&w.vault.address);
    let shares = w.vault.deposit(&w.alice, &100_0000000);

    // Alice pledges everything and borrows.
    w.pool.supply_collateral(&w.alice, &shares);
    w.pool.borrow(&w.alice, &50_0000000);

    let price_before = w.vault.share_price();
    let hf_before = w.pool.health_factor(&w.alice);

    // NAV ticks up 1.0209 → 1.0409 (inside the deviation bound).
    w.set_nav(NAV_1_0409);

    let price_after = w.vault.share_price();
    let hf_after = w.pool.health_factor(&w.alice);

    // The pledged position appreciated exactly as an idle wallet would: share
    // price rose, and the borrower's health improved with it.
    assert!(price_after > price_before, "NAV accrual lifts share price");
    assert!(
        hf_after > hf_before,
        "pledged collateral captured the yield"
    );
}

/// Beat 5a — Distress and cure: a whitelisted liquidator repays and seizes shares at a bonus.
#[test]
fn beat_5a_whitelisted_liquidation() {
    let w = World::new();
    w.authorize_for_leod(&w.vault.address);
    let shares = w.vault.deposit(&w.alice, &100_0000000);

    // Alice borrows near the limit, then the NAV crashes → unhealthy.
    w.pool.supply_collateral(&w.alice, &shares);
    let coll_value = shares * w.vault.share_price() / SCALE;
    w.pool.borrow(&w.alice, &(coll_value * 8_000 / 10_000));
    w.crash_nav(SCALE * 80 / 100); // NAV → 0.80
    assert!(
        w.pool.health_factor(&w.alice) < SCALE,
        "position is liquidatable"
    );

    // The issuer's approved liquidator is whitelisted and acts.
    w.pool.set_whitelist(&w.liquidator, &true);
    let debt_before = w.pool.position(&w.alice).debt;
    let repay = debt_before / 2; // close factor
    let seize = w.pool.liquidate(&w.liquidator, &w.alice, &repay);

    assert!(seize > 0, "liquidator seized collateral");
    assert_eq!(w.vault.balance(&w.liquidator), seize);
    assert_eq!(w.pool.position(&w.alice).debt, debt_before - repay);
    // Bonus: the seized share value exceeds the debt repaid (5% liquidation bonus).
    let seized_value = seize * w.vault.share_price() / SCALE;
    assert!(seized_value > repay, "liquidator earned the bonus");
}

/// Beat 5b — The gate holds: an un-whitelisted wallet is refused the very same seizure.
#[test]
fn beat_5b_unwhitelisted_rejected() {
    let w = World::new();
    w.authorize_for_leod(&w.vault.address);
    let shares = w.vault.deposit(&w.alice, &100_0000000);

    w.pool.supply_collateral(&w.alice, &shares);
    let coll_value = shares * w.vault.share_price() / SCALE;
    w.pool.borrow(&w.alice, &(coll_value * 8_000 / 10_000));
    w.crash_nav(SCALE * 80 / 100);
    assert!(w.pool.health_factor(&w.alice) < SCALE);

    // rando is NOT whitelisted — the same distress, the same repay, refused.
    w.usdc_admin.mint(&w.rando, &100_0000000);
    let repay = w.pool.position(&w.alice).debt / 2;
    let res = w.pool.try_liquidate(&w.rando, &w.alice, &repay);
    assert_eq!(
        res.err(),
        Some(Ok(mini_pool::Error::NotWhitelisted)),
        "unlawful seizure is rejected"
    );
    // The position is untouched — no debt was pulled from the rejected caller.
    assert_eq!(w.usdc.balance(&w.rando), 100_0000000, "no debt was pulled");
}
