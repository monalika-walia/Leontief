import { Keypair } from "@stellar/stellar-sdk";
import { useState } from "react";
import { useApp } from "../ctx";
import { addr, i128, sym, u32 } from "../lib/chain";
import { demoSigner } from "../lib/demoSigner";
import { humanError } from "../lib/errors";
import { submitTx } from "../lib/submitTx";

type BeatState = {
  status: "idle" | "running" | "ok" | "fail-expected" | "error";
  note?: string;
  hash?: string;
};

export function Demo() {
  const { env, chain } = useApp();
  const [state, setState] = useState<Record<number, BeatState>>({});
  const set = (i: number, s: BeatState) => setState((cur) => ({ ...cur, [i]: s }));

  const user = () => demoSigner(env, "user");
  const admin = () => demoSigner(env, "admin");
  const liq = () => demoSigner(env, "liquidator");
  const rando = () => demoSigner(env, "rando");
  const nowTs = () => BigInt(Math.floor(Date.now() / 1000));

  const beats: {
    n: string;
    actor: string;
    caption: string;
    action: string;
    run: (i: number) => Promise<void>;
  }[] = [
    {
      n: "1",
      actor: "USER",
      caption: "A restricted bond can't move to a stranger — reverted, as designed.",
      action: "Send 1 LEOD to a random address",
      run: async (i) => {
        set(i, { status: "running" });
        try {
          const stranger = Keypair.random().publicKey();
          await submitTx(chain, user(), env.LEOD_SAC, "transfer", [
            addr(user().address),
            addr(stranger),
            i128(10_000_000n),
          ]);
          set(i, { status: "error", note: "Unexpected success — restriction not enforced." });
        } catch (e) {
          set(i, {
            status: "fail-expected",
            note: `Reverted, as designed — ${humanError("sac", e)}`,
          });
        }
      },
    },
    {
      n: "2",
      actor: "USER",
      caption: "Wrap 100 LEOD → the vault mints a composable ldLEOD share at NAV.",
      action: "Wrap 100 LEOD",
      run: async (i) => {
        set(i, { status: "running" });
        try {
          const r = await submitTx(chain, user(), env.VAULT_LEOD, "deposit", [
            addr(user().address),
            i128(1_000_000_000n),
          ]);
          set(i, { status: "ok", note: `Minted ${fmt(r.returnValue)} ldLEOD.`, hash: r.hash });
        } catch (e) {
          set(i, { status: "error", note: humanError("vault", e) });
        }
      },
    },
    {
      n: "3",
      actor: "USER",
      caption: "Supply the share as collateral and borrow 50 USDC against it.",
      action: "Supply 90 · borrow 50 USDC",
      run: async (i) => {
        set(i, { status: "running" });
        try {
          await submitTx(chain, user(), env.MINI_POOL, "supply_collateral", [
            addr(user().address),
            i128(900_000_000n),
          ]);
          const r = await submitTx(chain, user(), env.MINI_POOL, "borrow", [
            addr(user().address),
            i128(500_000_000n),
          ]);
          set(i, { status: "ok", note: "Borrowed 50 USDC against pledged ldLEOD.", hash: r.hash });
        } catch (e) {
          set(i, { status: "error", note: humanError("pool", e) });
        }
      },
    },
    {
      n: "4",
      actor: "ADMIN",
      caption: "…while pledged. A NAV tick lifts the share price for locked collateral too.",
      action: "Advance NAV +2%",
      run: async (i) => {
        set(i, { status: "running" });
        try {
          const before = await chain.tryRead<bigint>(env.VAULT_LEOD, "share_price");
          const r = await submitTx(chain, admin(), env.MOCK_ORACLE, "set_price", [
            sym(env.LEOD_ASSET_ID),
            i128(104_090_000_000_000n),
            u32Now(),
          ]);
          const after = await chain.tryRead<bigint>(env.VAULT_LEOD, "share_price");
          set(i, {
            status: "ok",
            note: `Share price ${fmt(before)} → ${fmt(after)} (pledged collateral appreciated).`,
            hash: r.hash,
          });
        } catch (e) {
          set(i, { status: "error", note: humanError("vault", e) });
        }
      },
    },
    {
      n: "5a",
      actor: "LIQUIDATOR (whitelisted)",
      caption: "Drop the NAV, and a whitelisted liquidator repays and seizes shares at a bonus.",
      action: "Drop NAV −40% · liquidate",
      run: async (i) => {
        set(i, { status: "running" });
        try {
          await submitTx(chain, admin(), env.ORACLE_ADAPTER, "accept_override", [
            sym(env.LEOD_ASSET_ID),
            i128(600_000_000_000n),
          ]);
          await submitTx(chain, admin(), env.MOCK_ORACLE, "set_price", [
            sym(env.LEOD_ASSET_ID),
            i128(60_000_000_000_000n),
            u32Now(),
          ]);
          const r = await submitTx(chain, liq(), env.MINI_POOL, "liquidate", [
            addr(liq().address),
            addr(user().address),
            i128(100_000_000n),
          ]);
          set(i, {
            status: "ok",
            note: `Seized ${fmt(r.returnValue)} ldLEOD (repaid 10 USDC + bonus).`,
            hash: r.hash,
          });
        } catch (e) {
          set(i, { status: "error", note: humanError("pool", e) });
        }
      },
    },
    {
      n: "5b",
      actor: "RANDO (not whitelisted)",
      caption: "Restricted collateral cannot be seized by just anyone.",
      action: "Attempt the same liquidation",
      run: async (i) => {
        set(i, { status: "running" });
        try {
          await submitTx(chain, rando(), env.MINI_POOL, "liquidate", [
            addr(rando().address),
            addr(user().address),
            i128(100_000_000n),
          ]);
          set(i, { status: "error", note: "Unexpected success — whitelist not enforced." });
        } catch (e) {
          set(i, { status: "fail-expected", note: `Rejected — ${humanError("pool", e)}` });
        }
      },
    },
  ];

  function u32Now() {
    return u32(Number(nowTs()) % 2 ** 31);
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <div>
        <div className="label mono">The five-beat thesis · live on testnet</div>
        <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 32 }}>
          Guided demo
        </h1>
        <div className="monoblock" style={{ marginTop: 12 }}>
          Testnet demonstration keys — throwaway, testnet-only. Never reuse this pattern on mainnet.
        </div>
      </div>

      <div className="col" style={{ gap: 12 }}>
        {beats.map((b, i) => {
          const s = state[i] ?? { status: "idle" };
          return (
            <div key={b.n} className="panel">
              <div className="row between center" style={{ flexWrap: "wrap", gap: 10 }}>
                <div>
                  <span className="chip" style={{ marginRight: 10 }}>
                    Beat {b.n}
                  </span>
                  <span className="label mono">acting as {b.actor}</span>
                  <p style={{ margin: "8px 0 0", fontSize: 15 }}>{b.caption}</p>
                </div>
                <button
                  type="button"
                  className="btn solid"
                  disabled={s.status === "running"}
                  onClick={() => b.run(i)}
                >
                  {s.status === "running" ? "Running…" : b.action}
                </button>
              </div>
              {s.note && (
                <div
                  className="monoblock"
                  style={{
                    marginTop: 12,
                    ...(s.status === "ok" || s.status === "fail-expected"
                      ? { borderColor: "var(--fg)" }
                      : {}),
                  }}
                >
                  {statusMark(s.status)} {s.note}
                  {s.hash && (
                    <>
                      {"  "}
                      <a
                        href={chain.explorerTx(s.hash)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ textDecoration: "underline" }}
                      >
                        view tx ↗
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function statusMark(s: BeatState["status"]): string {
  if (s === "ok" || s === "fail-expected") return "✓";
  if (s === "error") return "✗";
  return "·";
}

function fmt(v: unknown): string {
  if (typeof v === "bigint")
    return (Number(v) / 1e7).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return String(v ?? "");
}
