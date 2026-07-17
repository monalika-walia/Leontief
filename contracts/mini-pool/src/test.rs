#![cfg(test)]
use super::*;
use soroban_sdk::Env;

#[test]
fn scaffold_version() {
    let e = Env::default();
    let id = e.register(MiniPool, ());
    let client = MiniPoolClient::new(&e, &id);
    assert_eq!(client.version(), 0);
}
