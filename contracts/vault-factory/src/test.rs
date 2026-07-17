#![cfg(test)]
use super::*;
use soroban_sdk::Env;

#[test]
fn scaffold_version() {
    let e = Env::default();
    let id = e.register(VaultFactory, ());
    let client = VaultFactoryClient::new(&e, &id);
    assert_eq!(client.version(), 0);
}
