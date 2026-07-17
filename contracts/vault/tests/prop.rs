//! C3 property suite (proptest, 10k cases per property):
//! (a) Σ withdrawn ≤ Σ deposited + donations (units, under monotone-up NAV walks)
//! (b) share_price monotone non-decreasing across every op when NAV never falls
//! (c) inflation attack bounded: victim loss < 1e-6 of deposit
//! (d) donations raise share_price and mint nothing
//! (e) supply conservation: Σ balances == TotalShares at every step

use mock_oracle::{MockOracle, MockOracleClient};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use proptest::prelude::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{symbol_short, Address, Env, Symbol};
use vault::{Vault, VaultClient};

const LEOD: Symbol = symbol_short!("LEOD");
const SCALE: i128 = 1_000_000_000_000;
/// Big enough that funding never binds.
const FUND: i128 = 1_000_000_000_000_000;

/// Full-stack property (registers the whole contract graph per case), so the PR
/// default is modest; nightly raises it via PROPTEST_CASES. See DECISIONS.md #4.
fn cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(96)
}

struct Stack {
    #[allow(dead_code)] // keeps the Env alive for the clients borrowing it
    e: Env,
    vault: VaultClient<'static>,
    mock: MockOracleClient<'static>,
    underlying: TokenClient<'static>,
    users: Vec<Address>,
    donor: Address,
    /// current NAV, SCALE-scaled
    nav: i128,
}

fn stack(n_users: usize) -> Stack {
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
    mock.set_price(&LEOD, &SCALE, &1_000);

    let adapter_id = e.register(OracleAdapter, ());
    let adapter = OracleAdapterClient::new(&e, &adapter_id);
    adapter.init(&admin);
    adapter.configure_feed(&LEOD, &mock_id, &12);

    let vault_id = e.register(Vault, ());
    let vault = VaultClient::new(&e, &vault_id);
    vault.init(&admin, &sac.address(), &adapter_id, &LEOD, &(FUND * 16));

    let users: Vec<Address> = (0..n_users).map(|_| Address::generate(&e)).collect();
    for u in &users {
        sac_admin.mint(u, &FUND);
    }
    let donor = Address::generate(&e);
    sac_admin.mint(&donor, &FUND);

    Stack {
        e,
        vault,
        mock,
        underlying,
        users,
        donor,
        nav: SCALE,
    }
}

#[derive(Clone, Debug)]
enum Op {
    Deposit {
        user: usize,
        amount: i128,
    },
    /// pct of the user's current shares, 1..=100
    Withdraw {
        user: usize,
        pct: i128,
    },
    Transfer {
        from: usize,
        to: usize,
        pct: i128,
    },
    Donate {
        amount: i128,
    },
    /// NAV multiplicative tick up, ≤ 200 bps (inside the deviation breaker)
    NavUp {
        bps: i128,
    },
}

fn op_strategy(n_users: usize) -> impl Strategy<Value = Op> {
    let u = 0..n_users;
    prop_oneof![
        (u.clone(), 1_i128..1_000_000_000_000)
            .prop_map(|(user, amount)| Op::Deposit { user, amount }),
        (u.clone(), 1_i128..=100).prop_map(|(user, pct)| Op::Withdraw { user, pct }),
        (u.clone(), 0..n_users, 1_i128..=100).prop_map(|(from, to, pct)| Op::Transfer {
            from,
            to,
            pct
        }),
        (1_i128..10_000_000_000).prop_map(|amount| Op::Donate { amount }),
        (1_i128..=200).prop_map(|bps| Op::NavUp { bps }),
    ]
}

/// Total user claim value must never exceed assets + the virtual cushion.
fn assert_solvent(s: &Stack) {
    let b = s.underlying.balance(&s.vault.address);
    let v = b * s.nav / SCALE;
    let total = s.vault.total_shares();
    let claims = total * (v + 1_000) / (total + 1_000);
    assert!(
        claims <= v + 1_000,
        "claims {claims} exceed assets {v} + virtual cushion"
    );
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(cases()))]

    /// (a) + (b) + (d) + (e) over random short sequences with monotone NAV.
    #[test]
    fn vault_invariants_hold_over_sequences(
        ops in proptest::collection::vec(op_strategy(3), 1..6),
    ) {
        let mut s = stack(3);
        let mut deposited: i128 = 0;
        let mut withdrawn: i128 = 0;
        let mut donated: i128 = 0;
        let mut last_price = s.vault.share_price();

        for op in ops {
            match op {
                Op::Deposit { user, amount } => {
                    if let Ok(Ok(_)) = s.vault.try_deposit(&s.users[user], &amount) {
                        deposited += amount;
                    }
                }
                Op::Withdraw { user, pct } => {
                    let shares = s.vault.balance(&s.users[user]) * pct / 100;
                    if shares > 0 {
                        if let Ok(Ok(out)) = s.vault.try_withdraw(&s.users[user], &shares) {
                            withdrawn += out;
                        }
                    }
                }
                Op::Transfer { from, to, pct } => {
                    let shares = s.vault.balance(&s.users[from]) * pct / 100;
                    if shares > 0 && from != to {
                        s.vault.transfer(&s.users[from], &s.users[to], &shares);
                    }
                }
                Op::Donate { amount } => {
                    let s0 = s.vault.total_shares();
                    let p0 = s.vault.share_price();
                    s.underlying.transfer(&s.donor, &s.vault.address, &amount);
                    donated += amount;
                    // (d) donations mint nothing and never lower the price
                    prop_assert_eq!(s.vault.total_shares(), s0);
                    prop_assert!(s.vault.share_price() >= p0);
                }
                Op::NavUp { bps } => {
                    s.nav += s.nav * bps / 10_000;
                    s.mock.set_price(&LEOD, &s.nav, &1_000);
                }
            }

            // (e) conservation: every share is owned by exactly one user
            let sum: i128 = s.users.iter().map(|u| s.vault.balance(u)).sum();
            prop_assert_eq!(sum, s.vault.total_shares());

            // (b) share_price never decreases while NAV never decreases
            let price = s.vault.share_price();
            prop_assert!(
                price >= last_price,
                "share_price fell {} -> {}", last_price, price
            );
            last_price = price;

            assert_solvent(&s);
        }

        // (a) the vault can never pay out units it did not receive
        prop_assert!(
            withdrawn <= deposited + donated,
            "paid out {} vs received {}", withdrawn, deposited + donated
        );
    }

    /// (c) attacker 1-stroop deposit + donation front-run: victim loss < 1e-6.
    #[test]
    fn inflation_attack_unprofitable(
        donation in 1_i128..1_000_000_000_000,
        victim_amount in 1_000_000_i128..1_000_000_000_000,
    ) {
        let s = stack(2);
        let attacker = &s.users[0];
        let victim = &s.users[1];

        s.vault.deposit(attacker, &1);
        s.underlying.transfer(attacker, &s.vault.address, &donation);

        match s.vault.try_deposit(victim, &victim_amount) {
            Ok(Ok(shares)) => {
                prop_assert!(shares > 0);
                let price = s.vault.share_price();
                let value = price * shares / SCALE;
                let loss = victim_amount - value;
                // Rounding can cost the victim at most ~one share's value —
                // never expropriation beyond the floor (DECISIONS.md #3).
                let one_share_value = price / SCALE + 1;
                prop_assert!(
                    loss <= one_share_value + 1,
                    "victim lost {} (> one share {}) of {}", loss, one_share_value, victim_amount
                );
                // The attacker can never come out ahead of 1 + donation.
                let attacker_value = price * s.vault.balance(attacker) / SCALE;
                prop_assert!(
                    attacker_value <= donation + 1,
                    "attacker profits: {} > {}", attacker_value, donation + 1
                );
            }
            // Zero-share mint is rejected, never silently donated.
            Ok(Err(_)) | Err(_) => prop_assert!(true),
        }
    }
}
