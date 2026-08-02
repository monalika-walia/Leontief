// Vercel serverless function — reads the Leontief testnet contracts live and
// returns a JSON snapshot for the /performance dashboard. Reads run server-side
// via simulateTransaction (no keys, no client bundle), so the page is a thin
// fetch() poller and the data is genuinely on-chain + real-time.
//
// The vault's NAV now comes from a LIVE Reflector SEP-40 feed on testnet (via the
// reflector-feed shim mapping LEOD -> Reflector USDC, a stable ~$1 par-NAV proxy),
// so share_price / TVL / health update on real market data and never go stale.
// Wallet cost basis is the only non-live field (the chain does not store it); it
// was re-based to each wallet's collateral value at the Reflector cutover, so the
// unrealized-gain column tracks movement from the live-oracle baseline.
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const READ_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const SCALE = 1_000_000_000_000n;

const CONTRACTS = {
  vault: "CB64EHOFGTWH2USSZP3PL2B66XJ4KD6A6C3SFXKPNTEO3NCIZFZWLHUS",
  mini_pool: "CCX7Z6TGAVAKOYMS3QAHD4VZHQB2QCC2XVQ4UWBZFSOX4HHDBB45EQ54",
  oracle_adapter: "CC624XAUEW2MYLGRQ6LMLVJQWF3ER3FQXUW2UQIJ7N2JRIDBZTGBH7NC",
  usdc_sac: "CBZ6PBCQUQPAJKMC75PPUSVUBXZD3SNEZMYWHWHMKMYOT5H25SEDUE6Z",
  leod_sac: "CDE5ZRPD2SJCUZIKEVM546Y25YIER35WYKVWICQFDW3I2ZHL2MLD4AOW",
  mock_oracle: "CBKHRAA4GJPOP537MNZ5EVYPW5PSKV3S2R6MQPXP7MTWOJFXQMXXHSYG",
};

// Tracked wallets. basis = collateral value at the Reflector cutover (7-dec USD),
// so the unrealized column reads ~0 at switchover and then moves with the live NAV.
const WALLETS = [
  { address: "GCCDH7TXDEXCQZOCP7WTNV2MHSQOUSU736J6IRGZ5MPLJCNISGNMVYZD", basis: 50042822939 },
  { address: "GA4PG5M3WIIYYXKOQFTAZ6IINT7TKSNHHAD62AL32F4S3Q4IRBCL5XMB", basis: 30025693764 },
  { address: "GCD5FOZUGNHEG7WHBMZTKD6FFG3LB5A3O3UVN7LLN5S5AV5OZVX6YPUB", basis: 30025693769 },
  { address: "GB7XND6M7PLZEO5JSKXYFUOTA4TW6DIKJYFV42VRETWTZHFAI3JOKLKZ", basis: 25021411478 },
];

const HF_MAX = 9_000_000_000_000_000n; // above this = debt-free / infinity

async function read(server, cid, method, ...scvals) {
  const tx = new TransactionBuilder(new Account(READ_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(cid).call(method, ...scvals))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) {
    throw new Error(method + " read failed");
  }
  return scValToNative(sim.result.retval);
}

export default async function handler(_req, res) {
  try {
    const server = new rpc.Server(RPC);
    const addr = (a) => new Address(a).toScVal();

    const leod = nativeToScVal("LEOD", { type: "symbol" });
    const [sp, ts, tav, nav] = await Promise.all([
      read(server, CONTRACTS.vault, "share_price"),
      read(server, CONTRACTS.vault, "total_shares"),
      read(server, CONTRACTS.vault, "total_assets_value"),
      read(server, CONTRACTS.oracle_adapter, "get_nav", leod), // live Reflector NAV
    ]);
    const sharePrice = BigInt(sp);

    const users = await Promise.all(
      WALLETS.map(async (w) => {
        const [pos, hf] = await Promise.all([
          read(server, CONTRACTS.mini_pool, "position", addr(w.address)),
          read(server, CONTRACTS.mini_pool, "health_factor", addr(w.address)),
        ]);
        const cs = BigInt(pos.collateral_shares);
        const debt = BigInt(pos.debt);
        const cv = (cs * sharePrice) / SCALE;
        const hfBig = BigInt(hf);
        return {
          address: w.address,
          basis: w.basis,
          collateral_shares: Number(cs),
          debt: Number(debt),
          hf: hfBig > HF_MAX ? null : Number(hfBig),
          collateral_value: Number(cv),
          pnl: Number(cv) - w.basis,
        };
      }),
    );

    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=20");
    res.status(200).json({
      live: true,
      network: "testnet",
      asof: new Date().toISOString(),
      oracle: "reflector", // live SEP-40 feed (via reflector-feed shim → Reflector USDC)
      explorer: "https://stellar.expert/explorer/testnet",
      contracts: CONTRACTS,
      nav: Number(BigInt(nav.nav)), // live NAV, SCALE-scaled
      nav_ts: Number(BigInt(nav.ts)),
      share_price: Number(sharePrice),
      total_shares: Number(BigInt(ts)),
      total_assets_value: Number(BigInt(tav)),
      users,
    });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
}
