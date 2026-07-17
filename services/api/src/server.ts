import { createHash } from "node:crypto";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { migrate, sql } from "./db.js";
import { earlyAccessSchema } from "./schema.js";

/** Hash the client IP so we can rate-limit / dedupe abuse without storing PII. */
function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "leontief-dev-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/** Comma-separated allowlist; defaults to common local static-server ports. */
function corsOrigins(): string[] {
  return (
    process.env.CORS_ORIGINS ?? "http://localhost:4321,http://localhost:5173,http://localhost:8080"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: true });

  await app.register(cors, { origin: corsOrigins(), methods: ["POST", "GET"] });
  await app.register(rateLimit, { max: 20, timeWindow: "1 minute" });

  app.get("/health", async () => {
    await sql`SELECT 1`;
    return { ok: true };
  });

  // Landing early-access intake. Idempotent per email — resubmits update.
  app.post("/early-access", async (req, reply) => {
    const parsed = earlyAccessSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid", issues: parsed.error.issues });
    }
    const { website, email, role, assets, handle, source } = parsed.data;
    // Honeypot tripped → pretend success, store nothing.
    if (website) return reply.code(202).send({ ok: true });

    const ipHash = hashIp(req.ip);
    await sql`
      INSERT INTO early_access (email, role, assets, handle, source, ip_hash)
      VALUES (${email}, ${role ?? null}, ${assets ?? []}, ${handle ?? null}, ${source}, ${ipHash})
      ON CONFLICT (lower(email)) DO UPDATE SET
        role = COALESCE(EXCLUDED.role, early_access.role),
        assets = CASE WHEN cardinality(EXCLUDED.assets) > 0 THEN EXCLUDED.assets ELSE early_access.assets END,
        handle = COALESCE(EXCLUDED.handle, early_access.handle),
        updated_at = now()
    `;
    return reply.code(201).send({ ok: true });
  });

  // Aggregate count only — never expose the list publicly (PII).
  app.get("/early-access/count", async () => {
    const [{ count }] = await sql<{ count: string }[]>`SELECT count(*) FROM early_access`;
    return { count: Number(count) };
  });

  return app;
}

// Entry point (skipped when imported by tests).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const port = Number(process.env.PORT ?? 8787);
  migrate()
    .then(() => build())
    .then((app) => app.listen({ port, host: "0.0.0.0" }))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
