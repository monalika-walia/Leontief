// End-to-end link ceremony against a real Postgres. Opt-in, like the SDK's
// live.test.ts: CI has no database, so this skips unless LEONTIEF_DB=1.
//
//   docker compose up -d postgres
//   pnpm --filter @leontief/indexer migrate
//   LEONTIEF_DB=1 pnpm --filter @leontief/indexer test
import { Keypair } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateTelegram, sql } from "./db.js";
import { linkChallenge, sep53Digest } from "./sep53.js";

// ./api.js is imported lazily inside beforeAll: it pulls in ./config.js, which
// process.exit(2)s on missing contract env. A static import would kill this file
// at collection time on any machine without deploy.env sourced — including CI,
// where the whole point is that it skips quietly.
type Api = Awaited<ReturnType<typeof import("./api.js").buildApi>>;

const live = process.env.LEONTIEF_DB === "1";
const CHAT = -999_000_001; // a chat id no real user will hold

describe.skipIf(!live)("link ceremony (live Postgres)", () => {
  const wallet = Keypair.random();
  let app: Api;

  const mintCode = async (code: string, minutes = 15) => {
    await sql`
      INSERT INTO tg_link_codes (code, chat_id, expires_at)
      VALUES (${code}, ${CHAT}, now() + ${`${minutes} minutes`}::interval)`;
  };
  const sign = (code: string, address = wallet.publicKey()) =>
    wallet.sign(sep53Digest(linkChallenge(code, address))).toString("base64");

  beforeAll(async () => {
    await migrateTelegram();
    await sql`DELETE FROM tg_links WHERE chat_id = ${CHAT}`;
    await sql`DELETE FROM tg_link_codes WHERE chat_id = ${CHAT}`;
    const { buildApi } = await import("./api.js");
    app = await buildApi();
    await app.ready();
  });

  afterAll(async () => {
    await sql`DELETE FROM tg_links WHERE chat_id = ${CHAT}`;
    await sql`DELETE FROM tg_link_codes WHERE chat_id = ${CHAT}`;
    await app?.close();
    await sql.end();
  });

  it("serves a challenge bound to the code and address", async () => {
    await mintCode("AAAA1111");
    const res = await app.inject({
      method: "GET",
      url: `/tg/challenge?code=AAAA1111&address=${wallet.publicKey()}`,
    });
    expect(res.statusCode).toBe(200);
    const { challenge } = res.json();
    expect(challenge).toBe(linkChallenge("AAAA1111", wallet.publicKey()));
    expect(challenge).toContain("authorizes nothing");
  });

  it("binds the chat on a valid signature, then refuses the replay", async () => {
    await mintCode("BBBB2222");
    const body = {
      code: "BBBB2222",
      address: wallet.publicKey(),
      signature: sign("BBBB2222"),
      method: "signature" as const,
    };

    const ok = await app.inject({ method: "POST", url: "/tg/link", payload: body });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toEqual({ ok: true, method: "signature" });

    const [row] = await sql<{ address: string; verified: boolean; method: string }[]>`
      SELECT address, verified, method FROM tg_links WHERE chat_id = ${CHAT}`;
    expect(row).toMatchObject({ address: wallet.publicKey(), verified: true, method: "signature" });

    // Defaults are seeded so the user has working thresholds immediately.
    const [prefs] = await sql<{ hf_warn: string; hf_urgent: string }[]>`
      SELECT hf_warn::text, hf_urgent::text FROM alert_prefs WHERE chat_id = ${CHAT}`;
    expect(Number(prefs.hf_warn)).toBe(1.5);
    expect(Number(prefs.hf_urgent)).toBe(1.2);

    // The same signed payload, sent again, must not bind anything.
    const replay = await app.inject({ method: "POST", url: "/tg/link", payload: body });
    expect(replay.statusCode).toBe(409);
  });

  it("rejects a signature from a different key", async () => {
    await mintCode("CCCC3333");
    const impostor = Keypair.random();
    const res = await app.inject({
      method: "POST",
      url: "/tg/link",
      payload: {
        code: "CCCC3333",
        address: wallet.publicKey(),
        signature: impostor
          .sign(sep53Digest(linkChallenge("CCCC3333", wallet.publicKey())))
          .toString("base64"),
      },
    });
    expect(res.statusCode).toBe(401);
    // The code must survive a failed attempt — a wrong guess cannot burn it.
    const [code] = await sql<{ used_at: Date | null }[]>`
      SELECT used_at FROM tg_link_codes WHERE code = 'CCCC3333'`;
    expect(code.used_at).toBeNull();
  });

  it("rejects a signature for a DIFFERENT code (no cross-code replay)", async () => {
    await mintCode("DDDD4444");
    await mintCode("EEEE5555");
    const res = await app.inject({
      method: "POST",
      url: "/tg/link",
      payload: {
        code: "DDDD4444",
        address: wallet.publicKey(),
        signature: sign("EEEE5555"), // valid signature, wrong code
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expired code", async () => {
    await mintCode("FFFF6666", -1);
    const res = await app.inject({
      method: "POST",
      url: "/tg/link",
      payload: { code: "FFFF6666", address: wallet.publicKey(), signature: sign("FFFF6666") },
    });
    expect(res.statusCode).toBe(410);
  });

  it("rejects an unknown code and malformed input", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: "/tg/link",
      payload: { code: "ZZZZ9999", address: wallet.publicKey(), signature: sign("ZZZZ9999") },
    });
    expect(unknown.statusCode).toBe(404);

    const bad = await app.inject({
      method: "POST",
      url: "/tg/link",
      payload: { code: "nope", address: "not-an-address", signature: "x" },
    });
    expect(bad.statusCode).toBe(400);
  });
});
