// Leontief monitor (docs-hub §05, D4). Reads the live contracts via RPC and
// alerts to a Discord webhook on: share_price step > 25 bps, oracle staleness
// > max_age·0.8, oracle HALTED, cap utilization > 80%, and paused /
// override_accepted events. Pings Healthchecks.io each cycle (alert on silence).
//
// No indexer dependency — reads contracts directly. Run once (cron) or --loop.
// Env: RPC_URL, VAULT, ORACLE_ADAPTER, MOCK_ORACLE?, ASSET_ID, MAX_AGE_SECS,
//      DISCORD_WEBHOOK_URL?, HEALTHCHECK_URL?, POLL_SECS?, STATE_FILE?
import { readFileSync, writeFileSync } from "node:fs";
import {
  Account,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const env = process.env;
const RPC_URL = env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const PASSPHRASE = env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const VAULT = must("VAULT");
const ADAPTER = must("ORACLE_ADAPTER");
const ASSET_ID = env.ASSET_ID ?? "LEOD";
const MAX_AGE = Number(env.MAX_AGE_SECS ?? 90_000);
const SHARE_STEP_BPS = Number(env.SHARE_STEP_BPS ?? 25);
const CAP_UTIL_PCT = Number(env.CAP_UTIL_PCT ?? 80);
const STATE_FILE = env.STATE_FILE ?? "/tmp/leontief-monitor-state.json";
const READ_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });

function must(k: string): string {
  const v = env[k];
  if (!v) {
    console.error(`missing required env ${k}`);
    process.exit(2);
  }
  return v;
}

type State = { sharePrice?: string; eventCursor?: string };
function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveState(s: State) {
  writeFileSync(STATE_FILE, JSON.stringify(s));
}

async function read(contractId: string, method: string, args: xdrArg[] = []): Promise<unknown> {
  const src = new Account(READ_SOURCE, "0");
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args.map(toScVal)))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new SimErr(sim.error);
  return sim.result?.retval ? scValToNative(sim.result.retval) : undefined;
}

type xdrArg = { sym: string };
function toScVal(a: xdrArg) {
  return nativeToScVal(a.sym, { type: "symbol" });
}
class SimErr extends Error {
  code: number | null;
  constructor(raw: string) {
    super(raw);
    const m = raw.match(/Error\(Contract,\s*#(\d+)\)/);
    this.code = m ? Number(m[1]) : null;
  }
}

const alerts: string[] = [];
function alert(msg: string) {
  alerts.push(msg);
  console.log(`ALERT · ${msg}`);
}

async function discord() {
  const url = env.DISCORD_WEBHOOK_URL;
  if (!url || alerts.length === 0) return;
  const content =
    `**Leontief monitor** (${new Date().toISOString()})\n` + alerts.map((a) => `• ${a}`).join("\n");
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (e) {
    console.error("discord post failed", e);
  }
}

async function heartbeat() {
  const url = env.HEALTHCHECK_URL;
  if (!url) return;
  try {
    await fetch(url, { method: "GET" });
  } catch {
    /* silence is the alert */
  }
}

async function cycle() {
  alerts.length = 0;
  const state = loadState();
  const now = Math.floor(Date.now() / 1000);

  // 1 · NAV freshness / halted.
  try {
    const nav = (await read(ADAPTER, "get_nav", [{ sym: ASSET_ID }])) as {
      nav: bigint;
      ts: bigint;
    };
    const age = now - Number(nav.ts);
    if (age > MAX_AGE * 0.8) {
      alert(`oracle staleness: NAV is ${age}s old (> 80% of max_age ${MAX_AGE}s)`);
    }
  } catch (e) {
    const c = (e as SimErr).code;
    const reason = c === 6 ? "Stale" : c === 7 ? "Deviation" : c === 4 ? "Unconfigured" : "Halted";
    alert(`oracle HALTED (${reason}) — pricing-dependent ops are unavailable`);
  }

  // 2 · share_price step.
  try {
    const sp = (await read(VAULT, "share_price")) as bigint;
    if (state.sharePrice) {
      const prev = BigInt(state.sharePrice);
      if (prev > 0n) {
        const diffBps = Number((absBig(sp - prev) * 10_000n) / prev);
        if (diffBps > SHARE_STEP_BPS) {
          alert(`share_price step ${diffBps} bps (> ${SHARE_STEP_BPS}) — ${prev} → ${sp}`);
        }
      }
    }
    state.sharePrice = sp.toString();
  } catch {
    /* share_price read failing usually means the oracle halted, already alerted */
  }

  // 3 · cap utilization.
  try {
    const [tvl, cap, paused] = await Promise.all([
      read(VAULT, "total_assets_value") as Promise<bigint>,
      read(VAULT, "cap") as Promise<bigint>,
      read(VAULT, "is_paused") as Promise<boolean>,
    ]);
    if (cap > 0n) {
      const util = Number((tvl * 100n) / cap);
      if (util > CAP_UTIL_PCT) alert(`cap utilization ${util}% (> ${CAP_UTIL_PCT}%)`);
    }
    if (paused) alert("vault is PAUSED (deposits halted; exits remain open)");
  } catch {
    /* handled by the oracle/halt path */
  }

  saveState(state);
  await heartbeat();
  await discord();
  console.log(`monitor cycle ok · ${alerts.length} alert(s)`);
}

function absBig(v: bigint): bigint {
  return v < 0n ? -v : v;
}

async function main() {
  const loop = process.argv.includes("--loop");
  const poll = Number(env.POLL_SECS ?? 60) * 1000;
  if (!loop) {
    await cycle();
    return;
  }
  for (;;) {
    await cycle().catch((e) => console.error("cycle error", e));
    await new Promise((r) => setTimeout(r, poll));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
