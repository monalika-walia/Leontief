//! Mini-pool risk parameters (spec §6) + storage TTL policy (DECISIONS.md #1).

/// Internal price scale shared with the vault (spec §3).
pub const SCALE: i128 = 1_000_000_000_000;

/// Basis-point denominator.
pub const BPS: i128 = 10_000;

/// Max borrow: debt ≤ 80% of collateral value.
pub const LTV_BPS: i128 = 8_000;

/// Liquidation eligibility threshold: hf < 1 when debt > 85% of collateral value.
pub const LIQ_THRESHOLD_BPS: i128 = 8_500;

/// Liquidator seize bonus: +5%.
pub const LIQ_BONUS_BPS: i128 = 500;

/// Close factor: a single liquidation may repay at most debt/CLOSE_FACTOR_DIV.
pub const CLOSE_FACTOR_DIV: i128 = 2;

/// Extend a persistent entry when fewer than ~30 days of ledgers remain.
pub const TTL_THRESHOLD: u32 = 518_400;
/// Extend to the network maximum (~180 days).
pub const TTL_EXTEND_TO: u32 = 3_110_400;
