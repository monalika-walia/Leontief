//! blend-price-adapter constants.

/// Price scale this oracle reports. `share_price` leaves the vault SCALE-scaled
/// (10^12), so we report `decimals() = 12` and pass it through un-rescaled — no
/// precision loss, no double-scaling.
pub const PRICE_DECIMALS: u32 = 12;

/// Extend a persistent entry when fewer than ~30 days of ledgers remain.
pub const TTL_THRESHOLD: u32 = 518_400;
/// Extend to the network maximum (~180 days).
pub const TTL_EXTEND_TO: u32 = 3_110_400;
