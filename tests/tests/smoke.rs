//! Workspace smoke test — replaced by beat_1..beat_5b in C7.
use soroban_sdk::Env;

#[test]
fn workspace_links_all_contracts() {
    let e = Env::default();
    let vault = e.register(vault::Vault, ());
    let oracle = e.register(mock_oracle::MockOracle, ());
    assert_ne!(vault, oracle);
}
