//! vault-factory — deploys and registers per-asset vaults (spec §4, prompt C4).
//!
//! One vault per underlying, at a deterministic address (salt = sha256 of the
//! underlying's XDR). The child vault's admin is set to the FACTORY's admin —
//! spec §3's "factory at init" read as "set by the factory at init"; making the
//! factory contract itself the admin would leave children unpausable and block
//! the D3 multisig handover, since the factory exposes no admin passthroughs.
#![no_std]

mod constants;

use constants::{TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, Address,
    BytesN, Env, Symbol,
};

/// The child-vault surface the factory drives (C3's frozen `init` signature).
#[contractclient(name = "VaultInitClient")]
pub trait VaultInit {
    fn init(
        e: Env,
        admin: Address,
        underlying: Address,
        oracle: Address,
        asset_id: Symbol,
        cap: i128,
    );
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    Unauthorized = 2,
    AlreadyInitialized = 3,
    AlreadyDeployed = 4,
    InvalidInput = 5,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    // instance — config/admin only
    Admin,
    VaultWasmHash,
    // persistent — registry
    Registry(Address),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultDeployed {
    #[topic]
    pub underlying: Address,
    pub vault: Address,
    pub asset_id: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WasmHashSet {
    pub wasm_hash: BytesN<32>,
}

#[contract]
pub struct VaultFactory;

#[contractimpl]
impl VaultFactory {
    pub fn init(e: Env, admin: Address, vault_wasm_hash: BytesN<32>) -> Result<(), Error> {
        if e.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage()
            .instance()
            .set(&DataKey::VaultWasmHash, &vault_wasm_hash);
        Ok(())
    }

    /// Deploy + init + register the vault for `underlying`. Admin-gated: the
    /// registry maps each underlying to THE protocol vault, so an open deploy
    /// would let anyone squat an asset's slot with a hostile oracle.
    pub fn deploy_vault(
        e: Env,
        underlying: Address,
        oracle: Address,
        asset_id: Symbol,
        cap: i128,
    ) -> Result<Address, Error> {
        let admin = Self::admin_inner(&e)?;
        admin.require_auth();
        if cap < 0 {
            return Err(Error::InvalidInput);
        }
        let reg_key = DataKey::Registry(underlying.clone());
        if e.storage().persistent().has(&reg_key) {
            return Err(Error::AlreadyDeployed);
        }
        let wasm_hash: BytesN<32> = e
            .storage()
            .instance()
            .get(&DataKey::VaultWasmHash)
            .ok_or(Error::NotInitialized)?;

        // Deterministic address per underlying: salt = sha256(underlying XDR).
        let salt: BytesN<32> = e.crypto().sha256(&underlying.clone().to_xdr(&e)).to_bytes();
        let vault = e
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());

        VaultInitClient::new(&e, &vault).init(&admin, &underlying, &oracle, &asset_id, &cap);

        e.storage().persistent().set(&reg_key, &vault);
        e.storage()
            .persistent()
            .extend_ttl(&reg_key, TTL_THRESHOLD, TTL_EXTEND_TO);
        VaultDeployed {
            underlying,
            vault: vault.clone(),
            asset_id,
        }
        .publish(&e);
        Ok(vault)
    }

    pub fn vault_of(e: Env, underlying: Address) -> Option<Address> {
        let key = DataKey::Registry(underlying);
        let found = e.storage().persistent().get(&key);
        if found.is_some() {
            e.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
        found
    }

    /// Admin: point future deployments at a new vault wasm (release upgrades).
    pub fn set_wasm_hash(e: Env, hash: BytesN<32>) -> Result<(), Error> {
        Self::admin_inner(&e)?.require_auth();
        e.storage().instance().set(&DataKey::VaultWasmHash, &hash);
        WasmHashSet { wasm_hash: hash }.publish(&e);
        Ok(())
    }

    pub fn admin(e: Env) -> Result<Address, Error> {
        Self::admin_inner(&e)
    }

    fn admin_inner(e: &Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod test;
