//! vault-factory — scaffold placeholder. Real implementation lands with its
//! build-prompt PR (leontief-build-prompts.md, Phase C).
#![no_std]
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct VaultFactory;

#[contractimpl]
impl VaultFactory {
    /// Scaffold marker; replaced by the contract's real interface.
    pub fn version(_e: Env) -> u32 {
        0
    }
}

#[cfg(test)]
mod test;
