// Vercel serverless function — reads the Leontief testnet contracts live and
// returns a JSON snapshot for the /performance dashboard. Reads run server-side
// via simulateTransaction (no keys, no client bundle), so the page is a thin
// fetch() poller and the data is genuinely on-chain + real-time.
//
// Wallet cost basis (LEOD deposited x NAV at deposit) is the only non-live field
// (the chain does not store per-wallet basis), recorded here per test wallet;
// everything else (positions, health, share price, TVL) is read live.
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
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

// Tracked wallets. basis = USD (7-dec) put in, for the unrealized-gain column.
const WALLETS = [
  { address: "GCCDH7TXDEXCQZOCP7WTNV2MHSQOUSU736J6IRGZ5MPLJCNISGNMVYZD", basis: 51198000000 },
  { address: "GA4PG5M3WIIYYXKOQFTAZ6IINT7TKSNHHAD62AL32F4S3Q4IRBCL5XMB", basis: 30780000000 },
  { address: "GCD5FOZUGNHEG7WHBMZTKD6FFG3LB5A3O3UVN7LLN5S5AV5OZVX6YPUB", basis: 31086000000 },
  { address: "GB7XND6M7PLZEO5JSKXYFUOTA4TW6DIKJYFV42VRETWTZHFAI3JOKLKZ", basis: 26500000000 },
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

    const [sp, ts, tav] = await Promise.all([
      read(server, CONTRACTS.vault, "share_price"),
      read(server, CONTRACTS.vault, "total_shares"),
      read(server, CONTRACTS.vault, "total_assets_value"),
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
      explorer: "https://stellar.expert/explorer/testnet",
      contracts: CONTRACTS,
      share_price: Number(sharePrice),
      total_shares: Number(BigInt(ts)),
      total_assets_value: Number(BigInt(tav)),
      users,
    });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
}
