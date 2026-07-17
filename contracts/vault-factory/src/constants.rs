//! Storage TTL policy — values derived from testnet state-archival settings
//! verified 2026-07-16 (docs/ENVIRONMENT.md, DECISIONS.md #1).

/// Extend a persistent entry when fewer than ~30 days of ledgers remain.
pub const TTL_THRESHOLD: u32 = 518_400;
/// Extend to the network maximum (~180 days).
pub const TTL_EXTEND_TO: u32 = 3_110_400;
