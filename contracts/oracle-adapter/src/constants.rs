//! Adapter policy constants (spec §5) + storage TTL policy (DECISIONS.md #1).

/// Internal NAV scale: all navs leave this contract at 10^12 (spec §3 `SCALE`).
pub const SCALE_DECIMALS: u32 = 12;

/// Default staleness bound: 25 h — NAV updates on real-world cadence, not per-block.
pub const DEFAULT_MAX_AGE_SECS: u64 = 90_000;

/// Default per-update deviation bound: 200 bps — T-bill NAVs do not gap.
pub const DEFAULT_MAX_DEV_BPS: u32 = 200;

/// Extend a persistent entry when fewer than ~30 days of ledgers remain.
pub const TTL_THRESHOLD: u32 = 518_400;
/// Extend to the network maximum (~180 days).
pub const TTL_EXTEND_TO: u32 = 3_110_400;
