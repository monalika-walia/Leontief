import { useState } from "react";
import { HealthGauge } from "../components/HealthGauge";
import { LedgerPanel } from "../components/LedgerPanel";
import { useApp } from "../ctx";
import type { Position } from "../hooks";
import { POOL_PARAMS, useIsWhitelisted, useSharePrice } from "../hooks";
import { addr, i128 } from "../lib/chain";
import { amt, hfNumber, SCALE, STROOP } from "../lib/format";
import { useSubmit } from "../lib/useSubmit";

/** /liquidate — whitelist-gated console (A5). At-risk enumeration needs the
 *  indexer (A3); here a liquidator checks any address, previews the seize, acts. */
export function Liquidate() {
  const { env, wallet, chain } = useApp();
  const whitelisted = useIsWhitelisted(wallet.address);
  const price = useSharePrice();
  const submit = useSubmit();

  const [target, setTarget] = useState("");
  const [pos, setPos] = useState<Position | null>(null);
  const [hf, setHf] = useState<bigint | undefined>(undefined);
  const [repay, setRepay] = useState("");
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check() {
    setErr(null);
    setPos(null);
    if (!/^[GC][A-Z2-7]{55}$/.test(target)) {
      setErr("Enter a valid G… or C… address.");
      return;
    }
    setChecking(true);
    try {
      const p = await chain.read<Position>(env.MINI_POOL, "position", addr(target));
      const h = await chain.tryRead<bigint>(env.MINI_POOL, "health_factor", addr(target));
      setPos(p);
      setHf(h);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  const repayStroops = (() => {
    try {
      if (!repay) return 0n;
      const [w, f = ""] = repay.split(".");
      return BigInt(w) * STROOP + BigInt((f + "0000000").slice(0, 7));
    } catch {
      return 0n;
    }
  })();
  const sp = price.data ?? 0n;
  // seize ≈ ceil(repay·(1+bonus)·SCALE / share_price) — preview (contract is exact).
  const seizePreview =
    sp > 0n && repayStroops > 0n
      ? (repayStroops * BigInt(10_000 + POOL_PARAMS.liqBonusBps) * SCALE) / 10_000n / sp
      : 0n;
  const closeFactor = pos ? pos.debt / 2n : 0n;

  async function liquidate() {
    if (!pos || repayStroops <= 0n) return;
    await submit({
      kind: "pool",
      contractId: env.MINI_POOL,
      method: "liquidate",
      args: [addr(wallet.address!), addr(target), i128(repayStroops)],
      label: "Liquidate",
      invalidate: ["position", "hf", "vaultBalance"],
    });
    await check();
  }

  if (!wallet.address) {
    return (
      <LedgerPanel
        empty
        emptyCopy="Connect a whitelisted liquidator wallet to use this console."
        title="Liquidator console"
      />
    );
  }
  if (whitelisted.data === false) {
    return (
      <div className="panel">
        <h3>Liquidator console</h3>
        <p className="dim" style={{ fontSize: 14 }}>
          Your wallet <span className="mono">{wallet.address.slice(0, 6)}…</span> is not
          whitelisted. Liquidation of restricted collateral is permissioned — apply to the issuer to
          be added.
        </p>
        <p className="label mono" style={{ marginTop: 8 }}>
          Contact: security@leontief.app
        </p>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 24 }}>
      <div>
        <div className="label mono">Whitelisted liquidator</div>
        <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 32 }}>
          Liquidator console
        </h1>
      </div>

      <div className="panel">
        <div className="label">Check a borrower position</div>
        <div className="row center" style={{ gap: 10 }}>
          <input
            type="text"
            placeholder="G… or C… address"
            value={target}
            onChange={(e) => setTarget(e.target.value.trim())}
          />
          <button type="button" className="btn" onClick={check} disabled={checking}>
            {checking ? "Reading…" : "Check"}
          </button>
        </div>
        {err && (
          <div className="monoblock" style={{ marginTop: 10 }}>
            {err}
          </div>
        )}
      </div>

      {pos && (
        <div className="panel">
          <div className="row between" style={{ flexWrap: "wrap", gap: 16 }}>
            <div>
              <div className="label">Collateral</div>
              <div className="fig sm">{amt(pos.collateral_shares)} ldLEOD</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="label">Debt</div>
              <div className="fig sm">{amt(pos.debt)} USDC</div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <HealthGauge hf={hf} />
          </div>
          {hfNumber(hf) !== null && hfNumber(hf)! >= 1 ? (
            <div className="monoblock" style={{ marginTop: 12 }}>
              Position is healthy (hf ≥ 1) — not liquidatable.
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <div className="label">Repay (USDC) — max {amt(closeFactor)} (close factor ½)</div>
              <div className="row center" style={{ gap: 10 }}>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={repay}
                  onChange={(e) => setRepay(e.target.value.replace(/[^0-9.]/g, ""))}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => setRepay(amt(closeFactor, 7).replace(/,/g, ""))}
                >
                  Max
                </button>
              </div>
              <div className="label mono" style={{ marginTop: 12 }}>
                Seize preview ≈ {amt(seizePreview)} ldLEOD (repay + {POOL_PARAMS.liqBonusBps / 100}%
                bonus)
              </div>
              <button
                type="button"
                className="btn solid"
                style={{ marginTop: 14, width: "100%" }}
                disabled={repayStroops <= 0n || repayStroops > closeFactor}
                onClick={liquidate}
              >
                Liquidate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
