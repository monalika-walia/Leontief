import { useCallback, useEffect, useState } from "react";
import { useApp } from "../ctx";
import {
  describeLimits,
  generateSessionKey,
  grantSessionSigner,
  type Limits,
  revokeSessionSigner,
  type SessionKey,
} from "../lib/autopilot";

type LogRow = {
  action: string;
  amount: string;
  tx: string | null;
  pre_hf: string | null;
  post_hf: string | null;
  outcome: string;
  detail: string | null;
  created_at: string;
};
type GrantView = {
  strategy: string;
  session_public: string | null;
  expires_at: string;
  revoked: boolean;
  per_action_cap: string;
  daily_cap: string;
} | null;

const hf = (v: string | null) => (v === null ? "—" : (Number(v) / 1e12).toFixed(3));

/**
 * Autopilot panel (A8 Tier 2). Never enabled by default; testnet only.
 *
 * Disable is rendered at the same visual weight as Enable, deliberately: a
 * control that grants signing authority should not be easier to press than the
 * one that takes it away.
 */
export function Autopilot() {
  const { env, chain, wallet } = useApp();
  const api = env.INDEXER_URL;
  const [limits, setLimits] = useState<Limits>({
    strategy: "digest-only",
    perActionCap: "100",
    dailyCap: "250",
    expiryDays: 30,
  });
  const [grant, setGrant] = useState<GrantView>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionKey | null>(null);

  const testnet = env.NETWORK_PASSPHRASE.includes("Test SDF Network");

  // Re-read after every grant or revoke, so the panel always reflects the chain
  // rather than what we hoped the last click did.
  const reload = useCallback(async () => {
    if (!wallet.address) return;
    try {
      const res = await fetch(`${api}/autopilot/${wallet.address}`);
      const d = (res.ok ? await res.json() : { grant: null, log: [] }) as {
        grant: GrantView;
        log: LogRow[];
      };
      setGrant(d.grant);
      setLog(d.log ?? []);
    } catch {
      /* panel stays on its last known state */
    }
  }, [api, wallet.address]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function enable() {
    if (!wallet.signer) return;
    setError(null);
    setBusy("enable");
    try {
      const key = generateSessionKey();
      const hash = await grantSessionSigner(
        chain.server,
        env.NETWORK_PASSPHRASE,
        wallet.signer,
        key.publicKey,
      );
      await fetch(`${api}/autopilot/grant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: wallet.address,
          strategy: limits.strategy,
          perActionCap: limits.perActionCap,
          dailyCap: limits.dailyCap,
          expiryDays: limits.expiryDays,
          sessionPublic: key.publicKey,
          grantTx: hash,
        }),
      });
      setSession(key);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    if (!wallet.signer || !grant?.session_public) return;
    setError(null);
    setBusy("disable");
    try {
      await revokeSessionSigner(
        chain.server,
        env.NETWORK_PASSPHRASE,
        wallet.signer,
        grant.session_public,
      );
      await fetch(`${api}/autopilot/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: wallet.address }),
      });
      setSession(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const { can, cannot } = describeLimits(limits);
  const active = grant && !grant.revoked;

  if (!testnet) {
    return (
      <div className="wrap" style={{ padding: "64px 24px", maxWidth: 680 }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 30 }}>
          Autopilot is testnet-only
        </h1>
        <p className="dim" style={{ marginTop: 14 }}>
          Mainnet Autopilot requires an audit and human sign-off. Full stop.
        </p>
      </div>
    );
  }

  return (
    <div className="wrap" style={{ padding: "48px 24px", maxWidth: 760 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: 32 }}>
        Autopilot
      </h1>
      <p className="dim" style={{ marginTop: 12 }}>
        A scripted policy loop that can act on your position within limits you set. Not an LLM — it
        follows the rules below and nothing else.
      </p>

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="label">Strategy</div>
        <div className="tabs">
          {(["digest-only", "hf-guard", "idle-sweep"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={limits.strategy === s ? "active" : ""}
              onClick={() => setLimits({ ...limits, strategy: s })}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 14, marginTop: 16, flexWrap: "wrap" }}>
          <div>
            <div className="label">Per-action cap (USDC)</div>
            <input
              type="text"
              inputMode="decimal"
              value={limits.perActionCap}
              onChange={(e) =>
                setLimits({ ...limits, perActionCap: e.target.value.replace(/[^0-9.]/g, "") })
              }
            />
          </div>
          <div>
            <div className="label">Daily cap (USDC)</div>
            <input
              type="text"
              inputMode="decimal"
              value={limits.dailyCap}
              onChange={(e) =>
                setLimits({ ...limits, dailyCap: e.target.value.replace(/[^0-9.]/g, "") })
              }
            />
          </div>
          <div>
            <div className="label">Expires in (days, max 30)</div>
            <input
              type="text"
              inputMode="numeric"
              value={String(limits.expiryDays)}
              onChange={(e) =>
                setLimits({
                  ...limits,
                  expiryDays: Math.min(30, Number(e.target.value.replace(/\D/g, "")) || 1),
                })
              }
            />
          </div>
        </div>

        <div className="monoblock" style={{ marginTop: 18 }}>
          {"It CAN:\n"}
          {can.map((l) => `  • ${l}\n`)}
          {"\nIt CANNOT:\n"}
          {cannot.map((l) => `  • ${l}\n`)}
        </div>

        <div className="monoblock" style={{ marginTop: 12 }}>
          {
            "Read this part twice. Enabling adds a session key as an additional signer on your\naccount. A Stellar signer is not limited to particular contracts: within your\naccount's medium threshold it could sign other things too. The limits above are\nenforced by the engine, not by the chain. What the chain does guarantee is that\nDisable removes the key immediately and the engine loses all capability."
          }
        </div>

        <div className="row" style={{ gap: 12, marginTop: 20 }}>
          <button
            type="button"
            className="btn solid"
            style={{ flex: 1 }}
            disabled={!wallet.address || busy !== null || !!active}
            onClick={enable}
          >
            {busy === "enable" ? "Granting…" : active ? "Autopilot is on" : "Enable Autopilot"}
          </button>
          {/* Equal visual weight to Enable — deliberately. */}
          <button
            type="button"
            className="btn solid"
            style={{ flex: 1 }}
            disabled={!wallet.address || busy !== null || !active}
            onClick={disable}
          >
            {busy === "disable" ? "Revoking…" : "Disable Autopilot"}
          </button>
        </div>

        {error && (
          <div className="monoblock" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}

        {session && (
          <div className="monoblock" style={{ marginTop: 14 }}>
            {`Session key granted: ${session.publicKey}\n\nHand this secret to the engine operator out of band; it is not stored by the app:\n${session.secret}\n\nTestnet only. Never do this on mainnet.`}
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="label">Action log</div>
        {log.length === 0 ? (
          <p className="dim" style={{ marginTop: 10 }}>
            Nothing yet. Every action, and every refusal, is recorded here with the health factor
            before and after.
          </p>
        ) : (
          <table style={{ width: "100%", marginTop: 10 }}>
            <tbody>
              {log.map((r) => (
                <tr key={`${r.created_at}-${r.action}`}>
                  <td className="mono">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="mono">{r.action}</td>
                  <td className="mono">{(Number(r.amount) / 1e7).toFixed(4)}</td>
                  <td className="mono">
                    {hf(r.pre_hf)} → {hf(r.post_hf)}
                  </td>
                  <td className="mono">{r.outcome}</td>
                  <td className="mono">
                    {r.tx ? (
                      <a
                        href={`${env.EXPLORER_BASE}/tx/${r.tx}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        tx
                      </a>
                    ) : (
                      (r.detail ?? "")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
