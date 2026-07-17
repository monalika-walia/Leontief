import Fastify, { type FastifyInstance } from "fastify";
import { PORT } from "./config.js";
import { migrate, sql } from "./db.js";
import { computeAtRisk, type Snapshot } from "./risk.js";

export async function buildApi(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  app.get("/health", async () => {
    await sql`SELECT 1`;
    const [c] = await sql<{ last_ledger: string; discontinuity: boolean }[]>`
      SELECT last_ledger, discontinuity FROM cursor WHERE id = 1`;
    return {
      ok: true,
      cursor: Number(c?.last_ledger ?? 0),
      discontinuity: c?.discontinuity ?? false,
    };
  });

  app.get("/metrics", async () => {
    const [totals] = await sql<
      { suppliers: string; borrowers: string; deployed: string; debt: string }[]
    >`
      SELECT
        count(*) FILTER (WHERE collateral_shares > 0) AS suppliers,
        count(*) FILTER (WHERE debt > 0) AS borrowers,
        COALESCE(sum(collateral_shares), 0) AS deployed,
        COALESCE(sum(debt), 0) AS debt
      FROM positions_snapshot`;
    const [ev] = await sql<
      { deposits: string; withdrawals: string; borrows: string; liquidations: string }[]
    >`
      SELECT
        COALESCE(sum(deposits),0) AS deposits, COALESCE(sum(withdrawals),0) AS withdrawals,
        COALESCE(sum(borrows),0) AS borrows, COALESCE(sum(liquidations),0) AS liquidations
      FROM metrics_daily`;
    const [sp] = await sql<{ share_price: string }[]>`
      SELECT share_price::text FROM share_price_series ORDER BY ts DESC LIMIT 1`;
    return {
      unique_suppliers: Number(totals?.suppliers ?? 0),
      active_borrowers: Number(totals?.borrowers ?? 0),
      deployed_shares: totals?.deployed ?? "0",
      total_debt: totals?.debt ?? "0",
      latest_share_price: sp?.share_price ?? null,
      lifetime: {
        deposits: Number(ev?.deposits ?? 0),
        withdrawals: Number(ev?.withdrawals ?? 0),
        borrows: Number(ev?.borrows ?? 0),
        liquidations: Number(ev?.liquidations ?? 0),
      },
    };
  });

  app.get<{ Params: { id: string } }>("/vaults/:id/history", async (req) => {
    const rows = await sql<{ ts: string; share_price: string }[]>`
      SELECT ts, share_price::text FROM share_price_series
      WHERE vault = ${req.params.id} ORDER BY ts ASC LIMIT 2000`;
    return { vault: req.params.id, series: rows };
  });

  // Positions at risk: hf < hf_lt (default 1.1). hf is recomputed from the
  // snapshot against the latest sampled share_price (best-effort; the contract
  // is authoritative at liquidation time).
  app.get<{ Querystring: { hf_lt?: string } }>("/positions/at-risk", async (req) => {
    const hfLt = Number(req.query.hf_lt ?? "1.1");
    const [sp] = await sql<{ share_price: string }[]>`
      SELECT share_price::text FROM share_price_series ORDER BY ts DESC LIMIT 1`;
    if (!sp) return { hf_lt: hfLt, share_price: null, positions: [] };
    const rows = await sql<{ account: string; collateral_shares: string; debt: string }[]>`
      SELECT account, collateral_shares::text, debt::text FROM positions_snapshot WHERE debt > 0`;
    const snaps: Snapshot[] = rows.map((r) => ({
      account: r.account,
      collateral_shares: BigInt(r.collateral_shares),
      debt: BigInt(r.debt),
    }));
    return {
      hf_lt: hfLt,
      share_price: sp.share_price,
      positions: computeAtRisk(snaps, BigInt(sp.share_price), hfLt),
    };
  });

  return app;
}

if (import.meta.url.endsWith(process.argv[1]?.split("/").pop() ?? "")) {
  migrate()
    .then(() => buildApi())
    .then((app) => app.listen({ port: PORT, host: "0.0.0.0" }))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
