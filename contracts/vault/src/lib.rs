//! vault — per-asset RWA wrapper; the contract IS its ld-share token (spec §3, prompt C3).
//!
//! ERC-4626-style with a SEP-41 surface. Accounting is value-consistent
//! (DECISIONS.md #3): both legs convert underlying units ⇄ quote value at the
//! fail-closed NAV, with the virtual offset `VIRT` applied to BOTH legs:
//!
//! - deposit: `received` is measured by balance-diff (never the caller's amount),
//!   valued at NAV, then `shares = value·(S+VIRT)/(V+VIRT)` — floor to the user.
//! - withdraw: `value = shares·(V+VIRT)/(S+VIRT)` floor, paid out as
//!   `value·SCALE/nav` floor — burn before transfer.
//! - `share_price = (V+VIRT)·SCALE/(S+VIRT)` in quote units per share: rebase
//!   assets raise it through balance growth, accrual assets through NAV growth —
//!   one formula, both mechanics, and it rises identically for pledged shares.
//!
//! Pause blocks deposits only. **Exits are never pausable.** Withdrawals do
//! depend on a live NAV (fail-closed oracle) — an oracle halt is an incident,
//! not a pause (spec §5).
#![no_std]

mod constants;

use constants::{DECIMALS, SCALE, TTL_EXTEND_TO, TTL_THRESHOLD, VIRT};
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, token,
    Address, Env, String, Symbol,
};

/// Adapter answer — must stay XDR-identical to oracle-adapter's `NavData`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NavData {
    pub nav: i128,
    pub ts: u64,
}

/// The read surface the vault requires from its oracle (the C2 adapter).
#[contractclient(name = "NavOracleClient")]
pub trait NavOracle {
    fn get_nav(e: Env, asset_id: Symbol) -> NavData;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    Paused = 2,
    CapExceeded = 3,
    ZeroAmount = 4,
    InsufficientShares = 5,
    OracleFailure = 6,
    Unauthorized = 7,
    AlreadyInitialized = 8,
    InsufficientAllowance = 9,
    MathOverflow = 10,
    InvalidAmount = 11,
    InvalidExpiration = 12,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    // instance — config/admin only
    Admin,
    PendingAdmin,
    Underlying,
    Oracle,
    AssetId,
    Cap,
    Paused,
    // persistent — user state
    TotalShares,
    Bal(Address),
    Allow(Address, Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowanceValue {
    pub amount: i128,
    pub live_until_ledger: u32,
}

// ── Events (spec §3 + SEP-41-shaped token events) ──────────────────────────────

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposit {
    #[topic]
    pub from: Address,
    pub amount: i128,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdraw {
    #[topic]
    pub from: Address,
    pub shares: i128,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapSet {
    pub cap: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Paused {
    pub paused: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleSet {
    pub oracle: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    pub admin: Address,
}

#[contractevent(data_format = "single-value")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Approve {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
    pub live_until_ledger: u32,
}

#[contractevent(data_format = "single-value")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Mint {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(data_format = "single-value")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Burn {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

/// `floor(a·b/den)` with checked ops; `den` must be positive (callers guarantee).
fn mul_div_floor(a: i128, b: i128, den: i128) -> Result<i128, Error> {
    a.checked_mul(b)
        .and_then(|p| p.checked_div(den))
        .ok_or(Error::MathOverflow)
}

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    // ── Lifecycle ──────────────────────────────────────────────────────────────

    pub fn init(
        e: Env,
        admin: Address,
        underlying: Address,
        oracle: Address,
        asset_id: Symbol,
        cap: i128,
    ) -> Result<(), Error> {
        if e.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        if cap < 0 {
            return Err(Error::InvalidAmount);
        }
        let inst = e.storage().instance();
        inst.set(&DataKey::Admin, &admin);
        inst.set(&DataKey::Underlying, &underlying);
        inst.set(&DataKey::Oracle, &oracle);
        inst.set(&DataKey::AssetId, &asset_id);
        inst.set(&DataKey::Cap, &cap);
        inst.set(&DataKey::Paused, &false);
        Ok(())
    }

    // ── Core: deposit / withdraw (spec §3 math, DECISIONS.md #3) ───────────────

    /// Wrap `amount` of the underlying; mints shares floor-rounded to the user.
    /// The accounted amount is the measured balance-diff, never the argument.
    pub fn deposit(e: Env, from: Address, amount: i128) -> Result<i128, Error> {
        from.require_auth();
        Self::extend_instance(&e);
        if Self::paused(&e)? {
            return Err(Error::Paused);
        }
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let nav = Self::nav(&e)?;
        let underlying = token::Client::new(&e, &Self::underlying_addr(&e)?);
        let vault_addr = e.current_contract_address();

        let bal_before = underlying.balance(&vault_addr);
        underlying.transfer(&from, &vault_addr, &amount);
        let bal_after = underlying.balance(&vault_addr);
        let received = bal_after
            .checked_sub(bal_before)
            .ok_or(Error::MathOverflow)?;
        if received <= 0 {
            return Err(Error::ZeroAmount);
        }
        if bal_after > Self::cap_inner(&e)? {
            return Err(Error::CapExceeded);
        }

        // Value both the pre-existing pool and the contribution at the same NAV.
        let v_before = mul_div_floor(bal_before, nav, SCALE)?;
        let value_in = mul_div_floor(received, nav, SCALE)?;
        if value_in <= 0 {
            return Err(Error::ZeroAmount);
        }

        let s = Self::total_shares_inner(&e);
        let shares = mul_div_floor(
            value_in,
            s.checked_add(VIRT).ok_or(Error::MathOverflow)?,
            v_before.checked_add(VIRT).ok_or(Error::MathOverflow)?,
        )?;
        if shares <= 0 {
            return Err(Error::ZeroAmount);
        }

        Self::mint_shares(&e, &from, shares)?;
        Deposit {
            from,
            amount: received,
            shares,
        }
        .publish(&e);
        Ok(shares)
    }

    /// Unwrap `shares`; pays out floor-rounded underlying. Burns before the
    /// transfer. NEVER gated on pause — exits stay open (CLAUDE.md).
    pub fn withdraw(e: Env, from: Address, shares: i128) -> Result<i128, Error> {
        from.require_auth();
        Self::admin_inner(&e)?; // init probe only — withdraw has NO pause gate
        Self::extend_instance(&e);
        if shares <= 0 {
            return Err(Error::ZeroAmount);
        }
        let bal = Self::balance_inner(&e, &from);
        if bal < shares {
            return Err(Error::InsufficientShares);
        }

        let nav = Self::nav(&e)?;
        let underlying = token::Client::new(&e, &Self::underlying_addr(&e)?);
        let vault_addr = e.current_contract_address();

        let b = underlying.balance(&vault_addr);
        let v = mul_div_floor(b, nav, SCALE)?;
        let s = Self::total_shares_inner(&e);

        let value_out = mul_div_floor(
            shares,
            v.checked_add(VIRT).ok_or(Error::MathOverflow)?,
            s.checked_add(VIRT).ok_or(Error::MathOverflow)?,
        )?;
        // Convert quote value back to underlying units — floor to the user; the
        // virtual legs can nominally exceed holdings when S > V, so clamp to B.
        let amount = mul_div_floor(value_out, SCALE, nav)?.min(b);
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        Self::burn_shares(&e, &from, shares)?;
        underlying.transfer(&vault_addr, &from, &amount);
        Withdraw {
            from,
            shares,
            amount,
        }
        .publish(&e);
        Ok(amount)
    }

    /// Quote value of one whole share, SCALE-scaled (spec §3). Rises with rebase
    /// balance growth AND with NAV accrual — pledged shares included (beat 4).
    pub fn share_price(e: Env) -> Result<i128, Error> {
        let nav = Self::nav(&e)?;
        let underlying = token::Client::new(&e, &Self::underlying_addr(&e)?);
        let b = underlying.balance(&e.current_contract_address());
        let v = mul_div_floor(b, nav, SCALE)?;
        let s = Self::total_shares_inner(&e);
        mul_div_floor(
            v.checked_add(VIRT).ok_or(Error::MathOverflow)?,
            SCALE,
            s.checked_add(VIRT).ok_or(Error::MathOverflow)?,
        )
    }

    /// Total pool value in quote units (7-dec), at the current fail-closed NAV.
    pub fn total_assets_value(e: Env) -> Result<i128, Error> {
        let nav = Self::nav(&e)?;
        let underlying = token::Client::new(&e, &Self::underlying_addr(&e)?);
        let b = underlying.balance(&e.current_contract_address());
        mul_div_floor(b, nav, SCALE)
    }

    // ── SEP-41 surface (mint/burn internal only) ───────────────────────────────

    pub fn transfer(e: Env, from: Address, to: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::move_shares(&e, &from, &to, amount)?;
        Transfer { from, to, amount }.publish(&e);
        Ok(())
    }

    pub fn transfer_from(
        e: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), Error> {
        spender.require_auth();
        Self::spend_allowance(&e, &from, &spender, amount)?;
        Self::move_shares(&e, &from, &to, amount)?;
        Transfer { from, to, amount }.publish(&e);
        Ok(())
    }

    pub fn approve(
        e: Env,
        from: Address,
        spender: Address,
        amount: i128,
        live_until_ledger: u32,
    ) -> Result<(), Error> {
        from.require_auth();
        Self::extend_instance(&e);
        if amount < 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::Allow(from.clone(), spender.clone());
        if amount == 0 {
            e.storage().persistent().remove(&key);
        } else {
            if live_until_ledger < e.ledger().sequence() {
                return Err(Error::InvalidExpiration);
            }
            e.storage().persistent().set(
                &key,
                &AllowanceValue {
                    amount,
                    live_until_ledger,
                },
            );
            e.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
        Approve {
            from,
            spender,
            amount,
            live_until_ledger,
        }
        .publish(&e);
        Ok(())
    }

    pub fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        match e
            .storage()
            .persistent()
            .get::<_, AllowanceValue>(&DataKey::Allow(from, spender))
        {
            Some(a) if a.live_until_ledger >= e.ledger().sequence() => a.amount,
            _ => 0,
        }
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        Self::balance_inner(&e, &id)
    }

    pub fn total_shares(e: Env) -> i128 {
        Self::total_shares_inner(&e)
    }

    pub fn decimals(_e: Env) -> u32 {
        DECIMALS
    }

    /// Static prototype metadata: init's frozen signature carries no name/symbol,
    /// and Symbol → String composition isn't available on-chain. Per-asset naming
    /// ("ldUSDY") is derived client-side from `asset_id` (SDK, Phase A1).
    pub fn name(e: Env) -> String {
        String::from_str(&e, "Leontief Share")
    }

    pub fn symbol(e: Env) -> String {
        String::from_str(&e, "ldSHARE")
    }

    // ── Admin (pause NEVER covers exits) ───────────────────────────────────────

    pub fn set_cap(e: Env, cap: i128) -> Result<(), Error> {
        Self::admin_inner(&e)?.require_auth();
        if cap < 0 {
            return Err(Error::InvalidAmount);
        }
        e.storage().instance().set(&DataKey::Cap, &cap);
        CapSet { cap }.publish(&e);
        Ok(())
    }

    pub fn set_oracle(e: Env, oracle: Address) -> Result<(), Error> {
        Self::admin_inner(&e)?.require_auth();
        e.storage().instance().set(&DataKey::Oracle, &oracle);
        OracleSet { oracle }.publish(&e);
        Ok(())
    }

    /// Blocks deposits only (spec §3). Withdrawals ignore this flag by design.
    pub fn pause(e: Env) -> Result<(), Error> {
        Self::admin_inner(&e)?.require_auth();
        e.storage().instance().set(&DataKey::Paused, &true);
        Paused { paused: true }.publish(&e);
        Ok(())
    }

    pub fn unpause(e: Env) -> Result<(), Error> {
        Self::admin_inner(&e)?.require_auth();
        e.storage().instance().set(&DataKey::Paused, &false);
        Paused { paused: false }.publish(&e);
        Ok(())
    }

    /// Two-step admin handover, step 1: propose (only the current admin).
    pub fn transfer_admin(e: Env, new_admin: Address) -> Result<(), Error> {
        Self::admin_inner(&e)?.require_auth();
        e.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        Ok(())
    }

    /// Two-step admin handover, step 2: the proposed admin accepts.
    pub fn accept_admin(e: Env) -> Result<(), Error> {
        let pending: Address = e
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::Unauthorized)?;
        pending.require_auth();
        e.storage().instance().set(&DataKey::Admin, &pending);
        e.storage().instance().remove(&DataKey::PendingAdmin);
        AdminChanged { admin: pending }.publish(&e);
        Ok(())
    }

    // ── Read-only config getters ───────────────────────────────────────────────

    pub fn admin(e: Env) -> Result<Address, Error> {
        Self::admin_inner(&e)
    }

    pub fn cap(e: Env) -> Result<i128, Error> {
        Self::cap_inner(&e)
    }

    pub fn is_paused(e: Env) -> Result<bool, Error> {
        Self::paused(&e)
    }

    pub fn underlying(e: Env) -> Result<Address, Error> {
        Self::underlying_addr(&e)
    }

    pub fn oracle(e: Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Oracle)
            .ok_or(Error::NotInitialized)
    }

    pub fn asset_id(e: Env) -> Result<Symbol, Error> {
        e.storage()
            .instance()
            .get(&DataKey::AssetId)
            .ok_or(Error::NotInitialized)
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    /// Fail-closed NAV read; any adapter error surfaces as `OracleFailure` and
    /// halts the calling operation. No fallback, ever (spec §5).
    fn nav(e: &Env) -> Result<i128, Error> {
        let oracle: Address = e
            .storage()
            .instance()
            .get(&DataKey::Oracle)
            .ok_or(Error::NotInitialized)?;
        let asset_id: Symbol = e
            .storage()
            .instance()
            .get(&DataKey::AssetId)
            .ok_or(Error::NotInitialized)?;
        match NavOracleClient::new(e, &oracle).try_get_nav(&asset_id) {
            Ok(Ok(nav_data)) if nav_data.nav > 0 => Ok(nav_data.nav),
            _ => Err(Error::OracleFailure),
        }
    }

    fn mint_shares(e: &Env, to: &Address, amount: i128) -> Result<(), Error> {
        let s = Self::total_shares_inner(e)
            .checked_add(amount)
            .ok_or(Error::MathOverflow)?;
        Self::set_total_shares(e, s);
        Self::set_balance(
            e,
            to,
            Self::balance_inner(e, to)
                .checked_add(amount)
                .ok_or(Error::MathOverflow)?,
        );
        Mint {
            to: to.clone(),
            amount,
        }
        .publish(e);
        Ok(())
    }

    fn burn_shares(e: &Env, from: &Address, amount: i128) -> Result<(), Error> {
        let bal = Self::balance_inner(e, from);
        if bal < amount {
            return Err(Error::InsufficientShares);
        }
        Self::set_balance(e, from, bal - amount);
        let s = Self::total_shares_inner(e)
            .checked_sub(amount)
            .ok_or(Error::MathOverflow)?;
        Self::set_total_shares(e, s);
        Burn {
            from: from.clone(),
            amount,
        }
        .publish(e);
        Ok(())
    }

    fn move_shares(e: &Env, from: &Address, to: &Address, amount: i128) -> Result<(), Error> {
        Self::extend_instance(e);
        if amount < 0 {
            return Err(Error::InvalidAmount);
        }
        let from_bal = Self::balance_inner(e, from);
        if from_bal < amount {
            return Err(Error::InsufficientShares);
        }
        Self::set_balance(e, from, from_bal - amount);
        Self::set_balance(
            e,
            to,
            Self::balance_inner(e, to)
                .checked_add(amount)
                .ok_or(Error::MathOverflow)?,
        );
        Ok(())
    }

    fn spend_allowance(
        e: &Env,
        from: &Address,
        spender: &Address,
        amount: i128,
    ) -> Result<(), Error> {
        if amount < 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::Allow(from.clone(), spender.clone());
        let allowance: AllowanceValue = e
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::InsufficientAllowance)?;
        if allowance.live_until_ledger < e.ledger().sequence() || allowance.amount < amount {
            return Err(Error::InsufficientAllowance);
        }
        let remaining = allowance.amount - amount;
        if remaining == 0 {
            e.storage().persistent().remove(&key);
        } else {
            e.storage().persistent().set(
                &key,
                &AllowanceValue {
                    amount: remaining,
                    live_until_ledger: allowance.live_until_ledger,
                },
            );
            e.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
        Ok(())
    }

    fn balance_inner(e: &Env, id: &Address) -> i128 {
        let key = DataKey::Bal(id.clone());
        match e.storage().persistent().get(&key) {
            Some(bal) => {
                e.storage()
                    .persistent()
                    .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
                bal
            }
            None => 0,
        }
    }

    fn set_balance(e: &Env, id: &Address, amount: i128) {
        let key = DataKey::Bal(id.clone());
        e.storage().persistent().set(&key, &amount);
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn total_shares_inner(e: &Env) -> i128 {
        let key = DataKey::TotalShares;
        match e.storage().persistent().get(&key) {
            Some(s) => {
                e.storage()
                    .persistent()
                    .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
                s
            }
            None => 0,
        }
    }

    fn set_total_shares(e: &Env, s: i128) {
        let key = DataKey::TotalShares;
        e.storage().persistent().set(&key, &s);
        e.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn cap_inner(e: &Env) -> Result<i128, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Cap)
            .ok_or(Error::NotInitialized)
    }

    fn paused(e: &Env) -> Result<bool, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Paused)
            .ok_or(Error::NotInitialized)
    }

    fn underlying_addr(e: &Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Underlying)
            .ok_or(Error::NotInitialized)
    }

    fn admin_inner(e: &Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    fn extend_instance(e: &Env) {
        e.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod test;
