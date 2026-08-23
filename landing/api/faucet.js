// Vercel serverless function — testnet faucet. Funds a connected wallet with test
// LEOD + USDC so anyone can try the app. LEOD is a SEP-8 restricted asset
// (auth_required), so the faucet MUST run server-side: it authorizes the user's
// trustline with the issuer key, then pays. The user creates the trustlines
// (change_trust) in their own wallet first; this endpoint does the rest.
//
// POST /api/faucet  { "address": "G..." }  →  { ok, leod_tx, usdc_tx }
//
// Env (set in Vercel project settings — testnet keys only, never mainnet):
//   FAUCET_ISSUER_SK  secret key of the LEOD issuer (authorizes + pays LEOD)
//   FAUCET_ADMIN_SK   secret key of the USDC issuer/admin (pays USDC)
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const HORIZON = "https://horizon-testnet.stellar.org";
const NET = Networks.TESTNET;
const LEOD_AMT = "1000"; // test LEOD per request
const USDC_AMT = "500"; // test USDC per request
const COOLDOWN_MS = 60_000; // basic per-address throttle (best-effort; resets on cold start)

const recent = new Map(); // address -> last epoch ms

function isG(a) {
  return typeof a === "string" && /^G[A-Z2-7]{55}$/.test(a);
}

async function submit(server, source, ops, signer) {
  const account = await server.loadAccount(source.publicKey());
  let b = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NET });
  for (const op of ops) b = b.addOperation(op);
  const tx = b.setTimeout(60).build();
  tx.sign(signer);
  const res = await server.submitTransaction(tx);
  return res.hash;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const issuerSk = process.env.FAUCET_ISSUER_SK;
  const adminSk = process.env.FAUCET_ADMIN_SK;
  if (!issuerSk || !adminSk) {
    return res.status(500).json({ error: "faucet not configured (missing signer env)" });
  }

  // GET → the assets/issuers the app needs to build the user's trustlines.
  if (req.method === "GET") {
    return res.status(200).json({
      network: "testnet",
      assets: [
        { code: "LEOD", issuer: Keypair.fromSecret(issuerSk).publicKey(), restricted: true },
        { code: "USDC", issuer: Keypair.fromSecret(adminSk).publicKey(), restricted: false },
      ],
      amounts: { LEOD: LEOD_AMT, USDC: USDC_AMT },
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const address = body?.address;
  if (!isG(address)) return res.status(400).json({ error: "invalid Stellar address" });

  const last = recent.get(address);
  if (last && Date.now() - last < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
    return res.status(429).json({ error: `slow down — try again in ${wait}s` });
  }

  try {
    const server = new Horizon.Server(HORIZON);
    const issuer = Keypair.fromSecret(issuerSk);
    const admin = Keypair.fromSecret(adminSk);
    const LEOD = new Asset("LEOD", issuer.publicKey());
    const USDC = new Asset("USDC", admin.publicKey());

    // 1 · issuer: authorize the (user-created) LEOD trustline, then pay LEOD.
    const leod_tx = await submit(
      server,
      issuer,
      [
        Operation.setTrustLineFlags({
          trustor: address,
          asset: LEOD,
          flags: { authorized: true },
        }),
        Operation.payment({ destination: address, asset: LEOD, amount: LEOD_AMT }),
      ],
      issuer,
    );

    // 2 · admin: pay USDC (unrestricted; user must hold a USDC trustline).
    const usdc_tx = await submit(
      server,
      admin,
      [Operation.payment({ destination: address, asset: USDC, amount: USDC_AMT })],
      admin,
    );

    recent.set(address, Date.now());
    return res.status(200).json({
      ok: true,
      network: "testnet",
      funded: { LEOD: LEOD_AMT, USDC: USDC_AMT },
      leod_tx,
      usdc_tx,
      explorer: "https://stellar.expert/explorer/testnet/tx/",
    });
  } catch (e) {
    // Most common cause: the user has not created the LEOD/USDC trustlines yet.
    const detail =
      e?.response?.data?.extras?.result_codes || e?.message || String(e);
    return res.status(400).json({
      error: "faucet failed — create the LEOD and USDC trustlines in your wallet first",
      detail,
    });
  }
}
