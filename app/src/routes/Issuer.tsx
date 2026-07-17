import { useState } from "react";
import { useApp } from "../ctx";
import { useFeedConfig, useNav, useTotalAssets, useVaultAdmin, useVaultTotals } from "../hooks";
import { i128 } from "../lib/chain";
import { ageLabel, amt, STROOP, scaled, shortAddr } from "../lib/format";
import { useSubmit } from "../lib/useSubmit";

/** /issuer — compliance panel (A6). Oracle config, cap/utilization, pause status;
 *  writes (pause, set_cap) enabled only when the connected wallet is the admin. */
export function Issuer() {
  const { env, wallet } = useApp();
  const totals = useVaultTotals();
  const tvl = useTotalAssets();
  const nav = useNav();
  const feed = useFeedConfig();
  const admin = useVaultAdmin();
  const submit = useSubmit();
  const [newCap, setNewCap] = useState("");

  const isAdmin = !!wallet.address && admin.data === wallet.address;
  const paused = totals.data?.paused;
  const cap = totals.data?.cap ?? 0n;
  const capPct = cap > 0n && tvl.data ? Number((tvl.data * 10_000n) / cap) / 100 : 0;

  async function setPause(pause: boolean) {
    await submit({
      kind: "vault",
      contractId: env.VAULT_LEOD,
      method: pause ? "pause" : "unpause",
      label: pause ? "Pause" : "Unpause",
      invalidate: ["vaultTotals"],
    });
  }
  async function applyCap() {
    if (!newCap) return;
    const [w, f = ""] = newCap.split(".");
    const stroops = BigInt(w) * STROOP + BigInt((f + "0000000").slice(0, 7));
    await submit({
      kind: "vault",
      contractId: env.VAULT_LEOD,
      method: "set_cap",
      args: [i128(stroops)],
      label: "Set cap",
      invalidate: ["vaultTotals"],
    });
    setNewCap("");
  }

  return (
    <div className="col" style={{ gap: 24 }}>
      <div>
        <div className="label mono">Issuer / compliance · LEOD</div>
        <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 32 }}>
          Issuer panel
        </h1>
        {wallet.address && !isAdmin && (
          <div className="label" style={{ marginTop: 6 }}>
            Read-only — connected wallet is not the vault admin. Writes build a tx only for the
            admin.
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Oracle config */}
        <div className="panel" style={{ flex: 1, minWidth: 320 }}>
          <h3>Oracle (fail-closed)</h3>
          <Line
            k="Status"
            v={
              nav.data?.ok ? "LIVE" : `HALTED · ${nav.data && !nav.data.ok ? nav.data.reason : ""}`
            }
          />
          {nav.data?.ok && (
            <Line k="Last NAV" v={`${scaled(nav.data.nav)} · ${ageLabel(nav.data.ts)}`} />
          )}
          {feed.data && (
            <>
              <Line k="Source" v={shortAddr(feed.data.source)} />
              <Line k="Source decimals" v={String(feed.data.source_decimals)} />
              <Line k="Max age" v={`${feed.data.max_age_secs.toString()} s`} />
              <Line k="Max deviation" v={`${feed.data.max_dev_bps} bps / update`} />
            </>
          )}
        </div>

        {/* Cap + pause */}
        <div className="panel" style={{ flex: 1, minWidth: 320 }}>
          <h3>Cap &amp; state</h3>
          <Line k="Cap" v={`${amt(cap)} LEOD`} />
          <Line k="Utilization" v={`${capPct.toFixed(1)}%`} />
          <div
            style={{ height: 6, background: "var(--hair)", position: "relative", margin: "8px 0" }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${Math.min(100, capPct)}%`,
                background: "var(--fg)",
              }}
            />
          </div>
          <Line k="Deposits" v={paused ? "PAUSED" : "OPEN"} />
          <div className="label" style={{ marginTop: 4 }}>
            Exits (withdraw/repay) are never pausable.
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="row" style={{ gap: 10 }}>
              <button
                type="button"
                className="btn"
                disabled={!isAdmin || paused}
                onClick={() => setPause(true)}
              >
                Pause
              </button>
              <button
                type="button"
                className="btn"
                disabled={!isAdmin || !paused}
                onClick={() => setPause(false)}
              >
                Unpause
              </button>
            </div>
            <div className="row center" style={{ gap: 10, marginTop: 14 }}>
              <input
                type="text"
                inputMode="decimal"
                placeholder="new cap (LEOD)"
                value={newCap}
                onChange={(e) => setNewCap(e.target.value.replace(/[^0-9.]/g, ""))}
              />
              <button
                type="button"
                className="btn solid"
                disabled={!isAdmin || !newCap}
                onClick={applyCap}
              >
                Set cap
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="label mono">
        Admin: {admin.data ? shortAddr(admin.data) : "…"} · underlying{" "}
        <a
          href={`${env.EXPLORER_BASE}/contract/${env.LEOD_SAC}`}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "underline" }}
        >
          {env.LEOD_SAC.slice(0, 6)}… ↗
        </a>
      </div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div
      className="row between"
      style={{ padding: "6px 0", borderBottom: "1px solid var(--hair)" }}
    >
      <span className="label">{k}</span>
      <span className="mono" style={{ fontSize: 13 }}>
        {v}
      </span>
    </div>
  );
}
