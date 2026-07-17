//! fuzz_vault_sequences (prompt C8) — arbitrary interleavings of
//! deposit / withdraw / transfer / donation with NAV walks that stay inside the
//! adapter's deviation bound, asserting the vault invariants after every op:
//!   (a) Σ withdrawn ≤ Σ deposited + donations (never pays out what it didn't take)
//!   (b) share_price monotone non-decreasing while NAV never decreases
//!   (e) supply conservation: Σ balances == total_shares
//!
//! Run: `cd fuzz && cargo +nightly fuzz run fuzz_vault_sequences`.
#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use mock_oracle::{MockOracle, MockOracleClient};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{symbol_short, Address, Env, Symbol};
use vault::{Vault, VaultClient};

const LEOD: Symbol = symbol_short!("LEOD");
const SCALE: i128 = 1_000_000_000_000;
const FUND: i128 = 1_000_000_000_000_000;

#[derive(Arbitrary, Debug)]
enum Op {
    Deposit { who: u8, amount: u32 },
    Withdraw { who: u8, pct: u8 },
    Transfer { from: u8, to: u8, pct: u8 },
    Donate { amount: u32 },
    NavUp { bps: u8 },
}

fuzz_target!(|input: (u16, Vec<Op>)| {
    let (nav0_bps, ops) = input;
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|l| {
        l.timestamp = 1_000;
        l.sequence_number = 100;
    });
    let admin = Address::generate(&e);

    let sac = e.register_stellar_asset_contract_v2(admin.clone());
    let underlying = TokenClient::new(&e, &sac.address());
    let sac_admin = StellarAssetClient::new(&e, &sac.address());

    let mock_id = e.register(MockOracle, ());
    let mock = MockOracleClient::new(&e, &mock_id);
    mock.init(&admin, &12);
    // NAV in [1.0, 1.5): starting point never zero.
    let mut nav = SCALE + (SCALE / 2) * (nav0_bps as i128) / (u16::MAX as i128);
    mock.set_price(&LEOD, &nav, &1_000);

    let adapter_id = e.register(OracleAdapter, ());
    let adapter = OracleAdapterClient::new(&e, &adapter_id);
    adapter.init(&admin);
    adapter.configure_feed(&LEOD, &mock_id, &12);

    let vault_id = e.register(Vault, ());
    let vault = VaultClient::new(&e, &vault_id);
    vault.init(&admin, &sac.address(), &adapter_id, &LEOD, &(FUND * 64));

    let users: Vec<Address> = (0..3).map(|_| Address::generate(&e)).collect();
    for u in &users {
        sac_admin.mint(u, &FUND);
    }
    let donor = Address::generate(&e);
    sac_admin.mint(&donor, &FUND);

    let mut deposited: i128 = 0;
    let mut withdrawn: i128 = 0;
    let mut donated: i128 = 0;
    let mut last_price = vault.share_price();

    for op in ops.into_iter().take(48) {
        match op {
            Op::Deposit { who, amount } => {
                let u = &users[(who as usize) % users.len()];
                let amt = (amount as i128) + 1;
                if amt <= underlying.balance(u) {
                    if let Ok(Ok(_)) = vault.try_deposit(u, &amt) {
                        deposited += amt;
                    }
                }
            }
            Op::Withdraw { who, pct } => {
                let u = &users[(who as usize) % users.len()];
                let shares = vault.balance(u) * (pct as i128 % 101) / 100;
                if shares > 0 {
                    if let Ok(Ok(out)) = vault.try_withdraw(u, &shares) {
                        withdrawn += out;
                    }
                }
            }
            Op::Transfer { from, to, pct } => {
                let f = &users[(from as usize) % users.len()];
                let t = &users[(to as usize) % users.len()];
                let shares = vault.balance(f) * (pct as i128 % 101) / 100;
                if shares > 0 && f != t {
                    let _ = vault.try_transfer(f, t, &shares);
                }
            }
            Op::Donate { amount } => {
                let amt = (amount as i128) + 1;
                if amt <= underlying.balance(&donor) {
                    let s0 = vault.total_shares();
                    underlying.transfer(&donor, &vault.address, &amt);
                    donated += amt;
                    // Donations mint nothing.
                    assert_eq!(vault.total_shares(), s0, "donation minted shares");
                }
            }
            Op::NavUp { bps } => {
                // Rise by ≤ 200 bps — inside the adapter's per-update bound.
                let step = nav * ((bps as i128) % 201) / 10_000;
                nav += step;
                mock.set_price(&LEOD, &nav, &1_000);
            }
        }

        // (e) conservation.
        let sum: i128 = users.iter().map(|u| vault.balance(u)).sum();
        assert_eq!(sum, vault.total_shares(), "supply not conserved");

        // (b) monotone share price under non-decreasing NAV.
        let price = vault.share_price();
        assert!(price >= last_price, "share_price fell: {last_price} -> {price}");
        last_price = price;
    }

    // (a) never pays out more than received.
    assert!(
        withdrawn <= deposited + donated,
        "paid {withdrawn} > received {}",
        deposited + donated
    );
});
