//! Shared harness for the cross-contract integration suite (beats 1..5b, spec §8, C7).
//!
//! Wires the full stack the way `setup_testnet.sh` will on testnet: a genuine
//! SEP-8 restricted asset **LEOD** (issuer flags `auth_required | auth_revocable`,
//! authorization driven through the SAC admin), a borrowable **USDC** SAC, the
//! mock oracle → fail-closed adapter → vault → mini-pool.

use mini_pool::{MiniPool, MiniPoolClient};
use mock_oracle::{MockOracle, MockOracleClient};
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use soroban_sdk::testutils::{Address as _, IssuerFlags, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{symbol_short, Address, Env, Symbol};
use vault::{Vault, VaultClient};

pub const LEOD: Symbol = symbol_short!("LEOD");
pub const SCALE: i128 = 1_000_000_000_000;
/// 1.0209 / 1.0409 / 1.0 at the mock feed's 14 decimals — the golden NAV points.
pub const NAV_1_0209: i128 = 102_090_000_000_000;
pub const NAV_1_0409: i128 = 104_090_000_000_000;
pub const NAV_1_0000: i128 = 100_000_000_000_000;

pub struct World {
    pub e: Env,
    pub admin: Address,
    pub leod: TokenClient<'static>,
    pub leod_admin: StellarAssetClient<'static>,
    pub usdc: TokenClient<'static>,
    pub usdc_admin: StellarAssetClient<'static>,
    pub mock: MockOracleClient<'static>,
    pub adapter: OracleAdapterClient<'static>,
    pub vault: VaultClient<'static>,
    pub pool: MiniPoolClient<'static>,
    pub alice: Address,
    pub bob: Address,
    pub liquidator: Address,
    pub rando: Address,
}

impl World {
    /// Full stack at NAV 1.0209. LEOD is restricted; only `alice` is authorized
    /// to start (so she can hold LEOD). The vault is NOT yet authorized — beat 1
    /// opens that door.
    pub fn new() -> World {
        let e = Env::default();
        e.mock_all_auths();
        e.ledger().with_mut(|l| {
            l.timestamp = 1_000;
            l.sequence_number = 100;
        });
        let admin = Address::generate(&e);

        // LEOD: a real SEP-8 asset (auth_required | auth_revocable).
        let leod_sac = e.register_stellar_asset_contract_v2(admin.clone());
        leod_sac.issuer().set_flag(IssuerFlags::RequiredFlag);
        leod_sac.issuer().set_flag(IssuerFlags::RevocableFlag);
        let leod = TokenClient::new(&e, &leod_sac.address());
        let leod_admin = StellarAssetClient::new(&e, &leod_sac.address());

        // USDC: plain borrowable asset.
        let usdc_sac = e.register_stellar_asset_contract_v2(admin.clone());
        let usdc = TokenClient::new(&e, &usdc_sac.address());
        let usdc_admin = StellarAssetClient::new(&e, &usdc_sac.address());

        // Oracle: mock feed (14 dec) → fail-closed adapter.
        let mock_id = e.register(MockOracle, ());
        let mock = MockOracleClient::new(&e, &mock_id);
        mock.init(&admin, &14);
        mock.set_price(&LEOD, &NAV_1_0209, &1_000);
        let adapter_id = e.register(OracleAdapter, ());
        let adapter = OracleAdapterClient::new(&e, &adapter_id);
        adapter.init(&admin);
        adapter.configure_feed(&LEOD, &mock_id, &14);

        // Vault + mini-pool.
        let vault_id = e.register(Vault, ());
        let vault = VaultClient::new(&e, &vault_id);
        vault.init(
            &admin,
            &leod_sac.address(),
            &adapter_id,
            &LEOD,
            &10_000_000_000_000,
        );
        let pool_id = e.register(MiniPool, ());
        let pool = MiniPoolClient::new(&e, &pool_id);
        pool.init(&admin, &vault_id, &usdc_sac.address(), &adapter_id);
        usdc_admin.mint(&pool_id, &10_000_000_000_000);

        let alice = Address::generate(&e);
        let bob = Address::generate(&e);
        let liquidator = Address::generate(&e);
        let rando = Address::generate(&e);

        // Alice is authorized to hold LEOD; rando/vault are deliberately not.
        leod_admin.set_authorized(&alice, &true);
        leod_admin.mint(&alice, &100_000_000_000);
        usdc_admin.mint(&liquidator, &10_000_000_000_000);

        World {
            e,
            admin,
            leod,
            leod_admin,
            usdc,
            usdc_admin,
            mock,
            adapter,
            vault,
            pool,
            alice,
            bob,
            liquidator,
            rando,
        }
    }

    /// SAC-admin authorizes an address to hold/receive LEOD (the vault, etc.).
    pub fn authorize_for_leod(&self, who: &Address) {
        self.leod_admin.set_authorized(who, &true);
    }

    pub fn set_nav(&self, nav_14dec: i128) {
        self.mock.set_price(&LEOD, &nav_14dec, &1_000);
    }

    /// Move the NAV beyond the adapter's per-update deviation bound via the
    /// documented admin override (the testnet drill path), then update the feed.
    pub fn crash_nav(&self, nav_scaled: i128) {
        self.adapter.accept_override(&LEOD, &nav_scaled);
        // Mirror the override into the raw feed so subsequent get_nav calls read
        // the same level: 14-dec feed = 12-dec (SCALE) value × 100.
        self.mock.set_price(&LEOD, &(nav_scaled * 100), &1_000);
    }
}

impl Default for World {
    fn default() -> Self {
        Self::new()
    }
}
