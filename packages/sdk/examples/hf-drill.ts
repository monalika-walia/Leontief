// hf-drill.ts — drive a testnet position to a target health factor, then put it
// back. This is the scripted at-risk position both A8 acceptance criteria ask
// for: the Tier-1 alert drill ("beta user receives a forced HF warning") and the
// Tier-2 Autopilot drill ("hf-guard auto-repays a scripted at-risk position").
//
// It only ever borrows or repays against the driver's OWN position, on testnet,
// and it will not accept a target the pool's LTV cap makes unreachable.
//
//   source deploy.env
//   pnpm exec tsx packages/sdk/examples/hf-drill.ts 1.4        # sink to HF 1.4
//   pnpm exec tsx packages/sdk/examples/hf-drill.ts --restore  # repay it all
//
// Account: AGENT_SK if set, else DEMO_USER_SK.
import { healthFactor, keypairSigner, maxBorrowForHealthFactor, SCALE } from "../src/index.js";
import { clientFromEnv, fmt } from "./_env.js";

const TESTNET = "Test SDF Network ; September 2015";
const client = clientFromEnv();
if (client.config.networkPassphrase !== TESTNET) {
  throw new Error("hf-drill is TESTNET-only — refusing to run on this network");
}

// LTV 80% vs liquidation threshold 85% ⇒ a fresh borrow can never take the HF
// below 0.85/0.80. Asking for less is asking the pool to reject the draw.
const LTV_FLOOR = 1.0625;

const sk = process.env.AGENT_SK ?? process.env.DEMO_USER_SK;
if (!sk) throw new Error("set AGENT_SK or DEMO_USER_SK — source deploy.env first");
const me = keypairSigner(sk, TESTNET);

const arg = (process.argv[2] ?? "").trim();
const restore = arg === "--restore";
const target = restore ? 0 : Number(arg || "1.4");
if (!restore && (!Number.isFinite(target) || target < LTV_FLOOR)) {
  throw new Error(`target must be a number ≥ ${LTV_FLOOR} (the pool's LTV cap) — got "${arg}"`);
}

const hfLabel = (v: bigint | null) =>
  v === null ? "∞ (debt-free)" : (Number(v) / 1e12).toFixed(3);
const tx = (label: string, hash: string) =>
  console.log(`   ${label}  https://stellar.expert/explorer/testnet/tx/${hash}`);

const state = async () => {
  const [pos, price] = await Promise.all([client.positions(me.address), client.sharePrice()]);
  return { pos, price, hf: healthFactor(pos.collateral_shares, pos.debt, price) };
};

let s = await state();
console.log(
  `account   ${me.address}\n` +
    `position  ${fmt(s.pos.collateral_shares)} ld collateral · ${fmt(s.pos.debt)} USDC debt\n` +
    `health    ${hfLabel(s.hf)}`,
);

if (restore) {
  if (s.pos.debt <= 0n) {
    console.log("\nnothing to restore — the position is already debt-free.");
  } else {
    const idle = await client.debtBalance(me.address);
    const amount = idle < s.pos.debt ? idle : s.pos.debt;
    if (amount <= 0n) throw new Error("no idle USDC to repay with");
    const r = await client.repay(me, amount);
    console.log(`\nrepaid ${fmt(amount)} USDC`);
    tx("repay   ", r.hash);
    s = await state();
    console.log(`health    ${hfLabel(s.hf)}`);
  }
} else {
  // A drill has to be one command from a clean state, so if there is no
  // collateral yet, establish it from whatever the wallet already holds.
  if (s.pos.collateral_shares <= 0n) {
    const [free, wallet] = await Promise.all([
      client.ldBalance(me.address),
      client.underlyingBalance(me.address),
    ]);
    if (free <= 0n && wallet <= 0n) {
      throw new Error("no collateral, no ld-shares, and no underlying to wrap — fund the account");
    }
    let shares = free;
    if (wallet > 0n) {
      const w = await client.wrap(me, wallet);
      shares += w.returnValue as bigint;
      console.log(`\nwrapped ${fmt(wallet)} → ${fmt(w.returnValue as bigint)} ld-shares`);
      tx("wrap    ", w.hash);
    }
    const sup = await client.supplyCollateral(me, shares);
    console.log(`supplied ${fmt(shares)} ld-shares as collateral`);
    tx("supply  ", sup.hash);
    s = await state();
  }
  const targetScaled = BigInt(Math.round(target * 1e12));
  const draw = maxBorrowForHealthFactor(s.pos.collateral_shares, s.pos.debt, s.price, targetScaled);
  if (draw <= 0n) {
    console.log(`\nalready at or below HF ${target} — nothing to draw.`);
  } else {
    console.log(`\ndrawing ${fmt(draw)} USDC to sink the health factor to ≈ ${target}`);
    const b = await client.borrow(me, draw);
    tx("borrow  ", b.hash);
    s = await state();
    console.log(`health    ${hfLabel(s.hf)}`);
    console.log(
      "\nThe position is now inside the alert bands. Watch for the Telegram warning,\n" +
        "or let Autopilot's hf-guard repay it. Undo with: hf-drill.ts --restore",
    );
  }
}
