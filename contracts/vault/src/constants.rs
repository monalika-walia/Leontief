//! Vault math + storage constants (spec §3, DECISIONS.md #1/#3).

/// Internal price scale: NAVs and `share_price` are scaled by 10^12.
pub const SCALE: i128 = 1_000_000_000_000;

/// Virtual-share offset applied to BOTH mint and redeem legs (inflation-attack
/// defense, spec §3). Never change one leg without the other.
pub const VIRT: i128 = 1_000;

/// ld-shares expose 7 decimals — matching classic-asset SAC amounts.
pub const DECIMALS: u32 = 7;

/// Extend a persistent entry when fewer than ~30 days of ledgers remain.
pub const TTL_THRESHOLD: u32 = 518_400;
/// Extend to the network maximum (~180 days).
pub const TTL_EXTEND_TO: u32 = 3_110_400;
