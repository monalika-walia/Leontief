//! mini-pool — isolated borrow market with permissioned liquidation (spec §6, C5+C6).
//!
//! Deliberately minimal: it exists so the liquidation demo is deterministic and
//! Blend is not a dependency. **v0 charges NO interest — fixed 0% APR.** Interest
//! modeling is the credit venue's job at mainnet (Blend, docs-hub §02).
//!
//! ## Unit trail (spec §6, DECISIONS.md #3)
//! ld-shares (7-dec integer amounts) → `vault.share_price` is QUOTE units per
//! share, SCALE-scaled (10^12), and already embeds the fail-closed NAV →
//! `coll_value = shares · share_price / SCALE` lands in USD 7-dec — the same
//! units as the debt SAC. NAV enters exactly once; multiplying by it again here
//! would double-count. The oracle address is stored for the record, but every
//! valuation flows through the vault so pricing stays fail-closed end to end.
//!
//! `repay` needs no valuation — like vault exits, it works during oracle halts
//! and has no pause (exits are never pausable).
#![no_std]

mod constants;

use constants::{
    BPS, CLOSE_FACTOR_DIV, LIQ_BONUS_BPS, LIQ_THRESHOLD_BPS, LTV_BPS, SCALE, TTL_EXTEND_TO,
    TTL_THRESHOLD,
};
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, token,
    Address, Env,
};

/// The ld-share surface the pool drives (C3 vault).
#[contractclient(name = "ShareVaultClient")]
pub trait ShareVault {
    fn share_price(e: Env) -> i128;
    fn transfer(e: Env, from: Address, to: Address, amount: i128);
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    Unauthorized = 2,
    AlreadyInitialized = 3,
    ZeroAmount = 4,
    InsufficientCollateral = 5,
    LtvExceeded = 6,
    UnsafeWithdraw = 7,
    NotWhitelisted = 8,
    HealthyPosition = 9,
    CloseFactorExceeded = 10,
    OracleFailure = 11,
    MathOverflow = 12,
    InsufficientLiquidity = 13,
}

/// A user's isolated position. Zero interest: `debt` only moves on
/// borrow/repay/liquidate.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub collateral_shares: i128,
    pub debt: i128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    // instance — config/admin only
    Admin,
    Collateral,
    Debt,
    Oracle,
    // persistent — user state
    Position(Address),
    Whitelist(Address),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Supplied {
    #[topic]
    pub user: Address,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    #[topic]
    pub user: Address,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Borrowed {
    #[topic]
    pub user: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Repaid {
    #[topic]
    pub user: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WhitelistSet {
    #[topic]
    pub who: Address,
    pub ok: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Liquidated {
    #[topic]
    pub user: Address,
    #[topic]
    pub liquidator: Address,
    pub repay: i128,
    pub seize: i128,
}

/// `floor(a·b/den)` with checked ops; `den` must be positive (callers guarantee).
fn mul_div_floor(a: i128, b: i128, den: i128) -> Result<i128, Error> {
    a.checked_mul(b)
        .and_then(|p| p.checked_div(den))
        .ok_or(Error::MathOverflow)
}

/// `ceil(a·b/den)` for non-negative operands — the protocol-side rounding.
fn mul_div_ceil(a: i128, b: i128, den: i128) -> Result<i128, Error> {
    let p = a.checked_mul(b).ok_or(Error::MathOverflow)?;
    let d = p.checked_add(den - 1).ok_or(Error::MathOverflow)?;
    Ok(d / den)
}

#[contract]
pub struct MiniPool;

#[contractimpl]
impl MiniPool {
    pub fn init(
        e: Env,
        admin: Address,
        collateral: Address,
        debt: Address,
        oracle: Address,
    ) -> Result<(), Error> {
        if e.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        let inst = e.storage().instance();
        inst.set(&DataKey::Admin, &admin);
        inst.set(&DataKey::Collateral, &collateral);
        inst.set(&DataKey::Debt, &debt);
        inst.set(&DataKey::Oracle, &oracle);
        Ok(())
    }

    /// Pledge ld-shares. The user's signature authorizes the nested vault
    /// transfer (soroban auth tree).
    pub fn supply_collateral(e: Env, from: Address, shares: i128) -> Result<(), Error> {
        from.require_auth();
        Self::extend_instance(&e);
        if shares <= 0 {
            return Err(Error::ZeroAmount);
        }
        let vault = ShareVaultClient::new(&e, &Self::collateral_addr(&e)?);
        vault.transfer(&from, &e.current_contract_address(), &shares);
        let mut pos = Self::position_inner(&e, &from);
        pos.collateral_shares = pos
            .collateral_shares
            .checked_add(shares)
            .ok_or(Error::MathOverflow)?;
        Self::set_position(&e, &from, &pos);
        Supplied { user: from, shares }.publish(&e);
        Ok(())
    }

    /// Unpledge ld-shares; post-condition hf ≥ 1 (UnsafeWithdraw otherwise).
    pub fn withdraw_collateral(e: Env, from: Address, shares: i128) -> Result<(), Error> {
        from.require_auth();
        Self::extend_instance(&e);
        if shares <= 0 {
            return Err(Error::ZeroAmount);
        }
        let mut pos = Self::position_inner(&e, &from);
        if pos.collateral_shares < shares {
            return Err(Error::InsufficientCollateral);
        }
        pos.collateral_shares -= shares;
        if Self::hf(&e, &pos)? < SCALE {
            return Err(Error::UnsafeWithdraw);
        }
        Self::set_position(&e, &from, &pos);
        let vault = ShareVaultClient::new(&e, &Self::collateral_addr(&e)?);
        vault.transfer(&e.current_contract_address(), &from, &shares);
        Withdrawn { user: from, shares }.publish(&e);
        Ok(())
    }

    /// Draw debt against pledged shares; post-condition debt ≤ LTV·coll_value.
    pub fn borrow(e: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::extend_instance(&e);
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        let debt_token = token::Client::new(&e, &Self::debt_addr(&e)?);
        let pool = e.current_contract_address();
        if debt_token.balance(&pool) < amount {
            return Err(Error::InsufficientLiquidity);
        }
        let mut pos = Self::position_inner(&e, &from);
        pos.debt = pos.debt.checked_add(amount).ok_or(Error::MathOverflow)?;

        // LTV gate — floor on collateral value is the conservative direction.
        let coll_value = Self::coll_value(&e, pos.collateral_shares)?;
        let max_debt = mul_div_floor(coll_value, LTV_BPS, BPS)?;
        if pos.debt > max_debt {
            return Err(Error::LtvExceeded);
        }

        Self::set_position(&e, &from, &pos);
        debt_token.transfer(&pool, &from, &amount);
        Borrowed { user: from, amount }.publish(&e);
        Ok(())
    }

    /// Pay debt down. NEVER pausable and needs no oracle — exits stay open
    /// (CLAUDE.md). Amounts above the outstanding debt are clamped, never taken.
    pub fn repay(e: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        Self::extend_instance(&e);
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        let mut pos = Self::position_inner(&e, &from);
        if pos.debt == 0 {
            return Err(Error::ZeroAmount);
        }
        let pay = amount.min(pos.debt);

        // Balance-diff measurement around the transfer-in (CLAUDE.md).
        let debt_token = token::Client::new(&e, &Self::debt_addr(&e)?);
        let pool = e.current_contract_address();
        let before = debt_token.balance(&pool);
        debt_token.transfer(&from, &pool, &pay);
        let received = debt_token
            .balance(&pool)
            .checked_sub(before)
            .ok_or(Error::MathOverflow)?;
        if received <= 0 {
            return Err(Error::ZeroAmount);
        }

        pos.debt -= received.min(pos.debt);
        Self::set_position(&e, &from, &pos);
        Repaid {
            user: from,
            amount: received,
        }
        .publish(&e);
        Ok(())
    }

    /// Permissioned liquidation (C6): whitelist → hf < 1 → close factor →
    /// pull debt (balance-diff) → reduce position → seize shares (+5% bonus,
    /// ceil on the protocol-side division) → transfer out → event.
    pub fn liquidate(
        e: Env,
        liquidator: Address,
        user: Address,
        repay: i128,
    ) -> Result<i128, Error> {
        liquidator.require_auth();
        Self::extend_instance(&e);
        if !Self::is_whitelisted_inner(&e, &liquidator) {
            return Err(Error::NotWhitelisted);
        }
        if repay <= 0 {
            return Err(Error::ZeroAmount);
        }
        let mut pos = Self::position_inner(&e, &user);
        if Self::hf(&e, &pos)? >= SCALE {
            return Err(Error::HealthyPosition);
        }
        if repay > pos.debt / CLOSE_FACTOR_DIV {
            return Err(Error::CloseFactorExceeded);
        }

        // Pull the repayment first, measured by balance-diff.
        let debt_token = token::Client::new(&e, &Self::debt_addr(&e)?);
        let pool = e.current_contract_address();
        let before = debt_token.balance(&pool);
        debt_token.transfer(&liquidator, &pool, &repay);
        let received = debt_token
            .balance(&pool)
            .checked_sub(before)
            .ok_or(Error::MathOverflow)?;
        if received <= 0 || received > pos.debt / CLOSE_FACTOR_DIV {
            return Err(Error::CloseFactorExceeded);
        }

        // seize = ceil(received·(1+bonus)·SCALE / share_price), capped at the
        // position's collateral. Ceil favors the protocol side; the share
        // transfer-out is an integer amount (floor by construction).
        let share_price = Self::share_price(&e)?;
        let bonus_value = mul_div_ceil(received, BPS + LIQ_BONUS_BPS, BPS)?;
        let seize = mul_div_ceil(bonus_value, SCALE, share_price)?.min(pos.collateral_shares);

        pos.debt -= received;
        pos.collateral_shares -= seize;
        Self::set_position(&e, &user, &pos);

        let vault = ShareVaultClient::new(&e, &Self::collateral_addr(&e)?);
        vault.transfer(&pool, &liquidator, &seize);
        Liquidated {
            user,
            liquidator,
            repay: received,
            seize,
        }
        .publish(&e);
        Ok(seize)
    }

    /// SCALE-scaled health factor; `i128::MAX` when debt-free (spec §6).
    pub fn health_factor(e: Env, user: Address) -> Result<i128, Error> {
        let pos = Self::position_inner(&e, &user);
        Self::hf(&e, &pos)
    }

    pub fn position(e: Env, user: Address) -> Position {
        Self::position_inner(&e, &user)
    }

    /// Admin: grant/revoke the liquidation permission (C6).
    pub fn set_whitelist(e: Env, who: Address, ok: bool) -> Result<(), Error> {
        Self::admin_inner(&e)?.require_auth();
        let key = DataKey::Whitelist(who.clone());
        if ok {
            e.storage().persistent().set(&key, &true);
            e.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        } else {
            e.storage().persistent().remove(&key);
        }
        WhitelistSet { who, ok }.publish(&e);
        Ok(())
    }

    pub fn is_whitelisted(e: Env, who: Address) -> bool {
        Self::is_whitelisted_inner(&e, &who)
    }

    pub fn admin(e: Env) -> Result<Address, Error> {
        Self::admin_inner(&e)
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    /// USD-7dec value of `shares` — see the unit trail in the crate docs.
    fn coll_value(e: &Env, shares: i128) -> Result<i128, Error> {
        if shares == 0 {
            return Ok(0);
        }
        mul_div_floor(shares, Self::share_price(e)?, SCALE)
    }

    /// hf = coll_value·liq_threshold/BPS · SCALE / debt (i128::MAX if debt = 0).
    fn hf(e: &Env, pos: &Position) -> Result<i128, Error> {
        if pos.debt == 0 {
            return Ok(i128::MAX);
        }
        let coll_value = Self::coll_value(e, pos.collateral_shares)?;
        let adjusted = mul_div_floor(coll_value, LIQ_THRESHOLD_BPS, BPS)?;
        mul_div_floor(adjusted, SCALE, pos.debt)
    }

    /// Fail-closed by construction: the vault's share_price propagates any
    /// oracle halt as an error — no fallback value exists on this path.
    fn share_price(e: &Env) -> Result<i128, Error> {
        let vault = ShareVaultClient::new(e, &Self::collateral_addr(e)?);
        match vault.try_share_price() {
            Ok(Ok(p)) if p > 0 => Ok(p),
            _ => Err(Error::OracleFailure),
        }
    }

    fn position_inner(e: &Env, user: &Address) -> Position {
        let key = DataKey::Position(user.clone());
        match e.storage().persistent().get(&key) {
            Some(p) => {
                e.storage()
                    .persistent()
                    .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
                p
            }
            None => Position {
                collateral_shares: 0,
                debt: 0,
            },
        }
    }

    fn set_position(e: &Env, user: &Address, pos: &Position) {
        let key = DataKey::Position(user.clone());
        if pos.collateral_shares == 0 && pos.debt == 0 {
            e.storage().persistent().remove(&key);
        } else {
            e.storage().persistent().set(&key, pos);
            e.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
    }

    fn is_whitelisted_inner(e: &Env, who: &Address) -> bool {
        e.storage()
            .persistent()
            .get(&DataKey::Whitelist(who.clone()))
            .unwrap_or(false)
    }

    fn admin_inner(e: &Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    fn collateral_addr(e: &Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Collateral)
            .ok_or(Error::NotInitialized)
    }

    fn debt_addr(e: &Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&DataKey::Debt)
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
