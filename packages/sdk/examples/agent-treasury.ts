// agent-treasury.ts — A7. An autonomous agent's treasury, run as a policy loop.
//
// HONEST FRAMING: this "agent" is a plain Stellar keypair plus the scripted
// policy below. There is no LLM and no autonomy beyond these rules. It exists to
// show that an agent earning stablecoin revenue can (a) park idle balances in a
// yield-bearing ld-share and (b) raise working capital by BORROWING against that
// share instead of liquidating it — entirely through the public SDK.
//
// Guardrails, enforced in code: testnet-only assertion · hard health-factor
// floor of 1.6 asserted before every draw · per-draw and total position caps ·
// bounded tick count. This pattern requires human sign-off before any mainnet
// use; nothing here is audited for production.
//
//   source deploy.env && ./scripts/agent_onboard.sh    # once: trustlines + SEP-8 auth
//   source deploy.env && pnpm exec tsx packages/sdk/examples/agent-treasury.ts
import { healthFactor, keypairSigner, maxBorrowForHealthFactor, SCALE } from "../src/index.js";
import { clientFromEnv, fmt } from "./_env.js";

// ── Policy (the entire "brain") ──────────────────────────────────────────────
const HF_FLOOR = (SCALE * 16n) / 10n; // 1.6 — never draw below this. No override.
const REVENUE = 250_0000000n; // one "invoice" of USDC revenue (faucet stands in for x402)
const IDLE_MAX = 100_0000000n; // X: idle USDC above this gets allocated to the vault
const IDLE_KEEP = 25_0000000n; // gas/float buffer the policy never allocates
const WORKING_MIN = 50_0000000n; // Y: below this, raise working capital by borrowing
const MAX_DRAW = 100_0000000n; // per-action notional cap
const MAX_POSITION = 5_000_0000000n; // total collateral cap (ld-shares)
const MAX_TICKS = 8; // hard loop bound — no unbounded automation

const TESTNET = "Test SDF Network ; September 2015";
const client = clientFromEnv();
if (client.config.networkPassphrase !== TESTNET) {
  throw new Error("agent-treasury is TESTNET-only — refusing to run on this network");
}

const env = (k: string): string => {
  const v = process.env[k];
  if (!v)
    throw new Error(`missing env ${k} — run ./scripts/agent_onboard.sh, then source deploy.env`);
  return v;
};
const usdc = env("USDC_SAC");
const mirror = env("LEOD_SAC");
const agent = keypairSigner(env("AGENT_SK"), TESTNET);
// Counterparties the agent transacts WITH — never part of the agent itself.
const payer = keypairSigner(env("DEMO_LIQUIDATOR_SK"), TESTNET); // pays the agent's invoices
const desk = keypairSigner(env("DEMO_ISSUER_SK"), TESTNET); // beta faucet for the mirror asset
const deskSettlement = env("ADMIN"); // where the agent's USDC settles for that fill

const tx = (label: string, hash: string) =>
  console.log(`   ${label}  https://stellar.expert/explorer/testnet/tx/${hash}`);

async function state() {
  const [idle, shares, pos, price, nav] = await Promise.all([
    client.debtBalance(agent.address), // USDC in the agent's wallet
    client.ldBalance(agent.address),
    client.positions(agent.address),
    client.sharePrice(),
    client.nav(),
  ]);
  return { idle, shares, pos, price, nav };
}

type S = Awaited<ReturnType<typeof state>>;
const treasuryValue = (s: S) => ((s.shares + s.pos.collateral_shares) * s.price) / SCALE + s.idle;

const hfLabel = (hf: bigint | null) =>
  hf === null ? "∞ (debt-free)" : (Number(hf) / 1e12).toFixed(3);

function report(tick: number, phase: string, s: S) {
  const hf = healthFactor(s.pos.collateral_shares, s.pos.debt, s.price);
  console.log(
    `\n▸ tick ${tick} · ${phase}\n` +
      `   idle ${fmt(s.idle)} USDC · collateral ${fmt(s.pos.collateral_shares)} ld · ` +
      `debt ${fmt(s.pos.debt)} USDC · HF ${hfLabel(hf)}\n` +
      `   NAV ${fmt(s.nav.nav, 12)} · share price ${fmt(s.price, 12)} · ` +
      `treasury ${fmt(treasuryValue(s))} USDC`,
  );
}

// ── The loop ─────────────────────────────────────────────────────────────────
type Phase = "earn" | "allocate" | "work" | "settle" | "unwind" | "done";
let phase: Phase = "earn";
let invoices = 0;
const opened = { shares: 0n }; // only unwind what THIS run opened

let ticks = 0;
for (let tick = 1; tick <= MAX_TICKS && phase !== "done"; tick++) {
  ticks = tick;
  const s = await state();
  report(tick, phase, s);

  if (phase === "earn") {
    // 1 · EARN — revenue arrives as ordinary USDC (x402 settles the same way).
    invoices++;
    const { hash } = await client.transfer(payer, usdc, agent.address, REVENUE);
    console.log(`   invoice #${invoices} settled: +${fmt(REVENUE)} USDC`);
    tx("revenue ", hash);
    phase = invoices === 1 ? "allocate" : "settle";
    continue;
  }

  if (phase === "allocate") {
    // 2 · ALLOCATE — idle cash above the policy ceiling buys the mirror asset and
    // is wrapped into ld-shares, then supplied so it can back working capital.
    if (s.idle <= IDLE_MAX) {
      phase = "work";
      continue;
    }
    // Two legs, both plain SEP-41 transfers: the agent settles in USDC, the desk
    // delivers the mirror asset at par. On mainnet this leg is a DEX route or an
    // issuer subscription; on testnet the desk is a beta faucet, nothing more.
    const spend = s.idle - IDLE_KEEP;
    const paid = await client.transfer(agent, usdc, deskSettlement, spend);
    tx("settle  ", paid.hash);
    const buy = await client.transfer(desk, mirror, agent.address, spend);
    console.log(`   paid ${fmt(spend)} USDC → received ${fmt(spend)} LEOD at par`);
    tx("acquire ", buy.hash);

    const wrapped = await client.wrap(agent, spend);
    const minted = wrapped.returnValue as bigint;
    opened.shares += minted;
    console.log(`   wrapped → ${fmt(minted)} ldLEOD (now earning while idle)`);
    tx("wrap    ", wrapped.hash);

    if (s.pos.collateral_shares + minted > MAX_POSITION) {
      throw new Error("policy: position cap would be exceeded — refusing to supply");
    }
    const sup = await client.supplyCollateral(agent, minted);
    tx("supply  ", sup.hash);
    phase = "work";
    continue;
  }

  if (phase === "work") {
    // 3 · WORKING CAPITAL — borrow against the shares rather than liquidating
    // them, and never past the floor. The treasury keeps earning throughout.
    if (s.idle >= WORKING_MIN) {
      phase = "earn";
      continue;
    }
    const room = maxBorrowForHealthFactor(s.pos.collateral_shares, s.pos.debt, s.price, HF_FLOOR);
    const draw = room < MAX_DRAW ? room : MAX_DRAW;
    if (draw <= 0n) {
      console.log("   no headroom above the 1.6 floor — standing down (no draw)");
      phase = "earn";
      continue;
    }
    const post = await client.previewHealthFactor(agent.address, 0n, draw);
    if (post === null || post < HF_FLOOR) {
      throw new Error(`policy: pre-flight HF ${post} below floor ${HF_FLOOR} — refusing to borrow`);
    }
    const b = await client.borrow(agent, draw);
    console.log(`   borrowed ${fmt(draw)} USDC · projected HF ${(Number(post) / 1e12).toFixed(3)}`);
    tx("borrow  ", b.hash);
    phase = "earn";
    continue;
  }

  if (phase === "settle") {
    // 4 · REPAY — the next revenue arrival clears the draw. No liquidation.
    if (s.pos.debt <= 0n) {
      phase = "unwind";
      continue;
    }
    const amount = s.idle < s.pos.debt ? s.idle : s.pos.debt;
    const r = await client.repay(agent, amount);
    console.log(`   repaid ${fmt(amount)} USDC from revenue`);
    tx("repay   ", r.hash);
    phase = "unwind";
    continue;
  }

  if (phase === "unwind") {
    // 5 · UNWIND — withdraw the collateral this run supplied and unwrap it back
    // to the underlying: principal, plus whatever the NAV accrued in between,
    // minus the sub-stroop rounding the protocol always takes in its own favour.
    if (opened.shares > 0n) {
      const w = await client.withdrawCollateral(agent, opened.shares);
      tx("withdraw", w.hash);
      const u = await client.unwrap(agent, opened.shares);
      console.log(
        `   unwrapped ${fmt(opened.shares)} ldLEOD → ${fmt(u.returnValue as bigint)} LEOD`,
      );
      tx("unwrap  ", u.hash);
    }
    phase = "done";
  }
}

const final = await state();
if (phase !== "done") console.log(`\n   tick cap reached with phase "${phase}" still open`);
report(ticks, "final", final);
console.log(
  `\n   ${invoices} invoice(s) earned · borrowed and repaid without selling the position.` +
    "\n   Policy loop only — no LLM, no custody, testnet only, human sign-off required for mainnet.",
);
