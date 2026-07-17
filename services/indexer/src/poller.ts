import {
  Account,
  BASE_FEE,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  ALL_CONTRACT_IDS,
  BACKFILL_LEDGERS,
  CONTRACTS,
  PASSPHRASE,
  POLL_SECS,
  RPC_URL,
} from "./config.js";
import { sql } from "./db.js";

const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });
const READ_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// Event topics that carry an account in topics[1] and should refresh a position.
const POSITION_TOPICS = new Set(["supplied", "withdrawn", "borrowed", "repaid", "liquidated"]);
const METRIC_BY_TOPIC: Record<string, string> = {
  deposit: "deposits",
  withdraw: "withdrawals",
  borrowed: "borrows",
};

async function readContract(id: string, method: string): Promise<unknown> {
  const tx = new TransactionBuilder(new Account(READ_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(id).call(method))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return sim.result?.retval ? scValToNative(sim.result.retval) : undefined;
}

async function positionOf(
  account: string,
): Promise<{ collateral_shares: bigint; debt: bigint } | undefined> {
  try {
    const tx = new TransactionBuilder(new Account(READ_SOURCE, "0"), {
      fee: BASE_FEE,
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(
        new Contract(CONTRACTS.mini_pool).call(
          "position",
          new (await import("@stellar/stellar-sdk")).Address(account).toScVal(),
        ),
      )
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) return undefined;
    return sim.result?.retval
      ? (scValToNative(sim.result.retval) as { collateral_shares: bigint; debt: bigint })
      : undefined;
  } catch {
    return undefined;
  }
}

async function getCursor(): Promise<{ last_ledger: number }> {
  const [row] = await sql<{ last_ledger: string }[]>`SELECT last_ledger FROM cursor WHERE id = 1`;
  return { last_ledger: Number(row?.last_ledger ?? 0) };
}

/** One poll cycle: fetch new events, store them, update derived tables + cursor. */
export async function pollOnce(): Promise<number> {
  const latest = await server.getLatestLedger();
  const cur = await getCursor();
  let start = cur.last_ledger + 1;
  let discontinuity = false;
  // Cursor lost or beyond RPC retention → resume from the backfill window.
  const earliest = latest.sequence - BACKFILL_LEDGERS;
  if (start <= 0 || start < earliest) {
    start = Math.max(1, earliest);
    if (cur.last_ledger > 0) discontinuity = true;
  }
  if (start > latest.sequence) return 0;

  const res = await server.getEvents({
    startLedger: start,
    // No `topics` key → match every event from these contracts (an empty
    // `topics: []` would instead match only events with zero topics).
    filters: [{ type: "contract", contractIds: ALL_CONTRACT_IDS }],
    limit: 200,
  });

  let stored = 0;
  const touchedAccounts = new Set<string>();
  for (const ev of res.events) {
    const topics = (ev.topic ?? []).map((t) => safeNative(t));
    const name = String(topics[0] ?? "unknown");
    const ledger = ev.ledger;
    const ts = ev.ledgerClosedAt ? new Date(ev.ledgerClosedAt) : new Date();
    const txHash = ev.txHash ?? "";
    const idx = Number((ev as { id?: string }).id?.split("-")[1] ?? 0);
    const value = safeNative(ev.value);

    const inserted = await sql`
      INSERT INTO events (contract_id, topic, ledger, ts, tx_hash, event_index, data)
      VALUES (${ev.contractId}, ${name}, ${ledger}, ${ts}, ${txHash}, ${idx},
              ${sql.json({ topics: topics.slice(1).map(String), value: String(value) })})
      ON CONFLICT (ledger, tx_hash, event_index) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) continue; // already seen
    stored++;

    const metric = METRIC_BY_TOPIC[name];
    if (metric) {
      await sql`
        INSERT INTO metrics_daily (day, ${sql(metric)}) VALUES (${ts}::date, 1)
        ON CONFLICT (day) DO UPDATE SET ${sql(metric)} = metrics_daily.${sql(metric)} + 1
      `;
    }
    if (name === "liquidated") {
      await sql`
        INSERT INTO metrics_daily (day, liquidations) VALUES (${ts}::date, 1)
        ON CONFLICT (day) DO UPDATE SET liquidations = metrics_daily.liquidations + 1
      `;
    }
    if (POSITION_TOPICS.has(name) && typeof topics[1] === "string") {
      touchedAccounts.add(topics[1]);
    }
  }

  // Refresh snapshots for accounts whose positions changed.
  for (const acct of touchedAccounts) {
    const p = await positionOf(acct);
    if (!p) continue;
    await sql`
      INSERT INTO positions_snapshot (account, collateral_shares, debt, updated_at)
      VALUES (${acct}, ${p.collateral_shares.toString()}, ${p.debt.toString()}, now())
      ON CONFLICT (account) DO UPDATE SET
        collateral_shares = EXCLUDED.collateral_shares,
        debt = EXCLUDED.debt,
        updated_at = now()
    `;
  }

  // Sample the vault share price each cycle for the history series.
  try {
    const sp = (await readContract(CONTRACTS.vault, "share_price")) as bigint;
    await sql`
      INSERT INTO share_price_series (vault, ts, share_price)
      VALUES (${CONTRACTS.vault}, now(), ${sp.toString()})
      ON CONFLICT (vault, ts) DO NOTHING
    `;
  } catch {
    /* oracle halted — skip this sample */
  }

  await sql`
    UPDATE cursor SET last_ledger = ${res.latestLedger ?? latest.sequence},
      discontinuity = ${discontinuity} WHERE id = 1
  `;
  return stored;
}

function safeNative(v: unknown): unknown {
  try {
    return scValToNative(v as never);
  } catch {
    return null;
  }
}

export async function pollLoop(): Promise<void> {
  for (;;) {
    try {
      const n = await pollOnce();
      if (n > 0) console.log(`indexer: stored ${n} new event(s)`);
    } catch (e) {
      console.error("poll error", e);
    }
    await new Promise((r) => setTimeout(r, POLL_SECS * 1000));
  }
}

// Run standalone: `pnpm --filter @leontief/indexer poll`
if (import.meta.url.endsWith(process.argv[1]?.split("/").pop() ?? "")) {
  pollLoop();
}
