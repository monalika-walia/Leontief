import { useState } from "react";
import { HealthGauge } from "../components/HealthGauge";
import { LedgerPanel } from "../components/LedgerPanel";
import { useApp } from "../ctx";
import {
  POOL_PARAMS,
  useHealthFactor,
  usePosition,
  useSharePrice,
  useTokenBalance,
  useVaultBalance,
} from "../hooks";
import { addr, i128 } from "../lib/chain";
import { amt, hfNumber, SCALE, STROOP } from "../lib/format";
import { useSubmit } from "../lib/useSubmit";

type Tab = "supply" | "borrow" | "repay" | "withdraw";

export function Borrow() {
  const { env, wallet } = useApp();
  const pos = usePosition(wallet.address);
  const hf = useHealthFactor(wallet.address);
  const price = useSharePrice();
  const ldBal = useVaultBalance(wallet.address);
  const usdcBal = useTokenBalance(env.USDC_SAC, wallet.address, "usdc");
  const submit = useSubmit();

  const [tab, setTab] = useState<Tab>("supply");
  const [amount, setAmount] = useState("");

  const parsed = (() => {
    try {
      if (!amount) return 0n;
      const [w, f = ""] = amount.split(".");
      return BigInt(w) * STROOP + BigInt((f + "0000000").slice(0, 7));
    } catch {
      return 0n;
    }
  })();

  const sp = price.data ?? 0n;
  const coll = pos.data?.collateral_shares ?? 0n;
  const debt = pos.data?.debt ?? 0n;
  const collValue = (coll * sp) / SCALE;
  const maxBorrow = (collValue * BigInt(POOL_PARAMS.ltvBps)) / 10_000n - debt;

  // Approximate post-action HF (≈; the contract enforces the exact bound).
  function postHf(): bigint | undefined {
    if (sp === 0n) return undefined;
    let c = coll;
    let d = debt;
    if (tab === "supply") c += parsed;
    if (tab === "withdraw") c -= parsed;
    if (tab === "borrow") d += parsed;
    if (tab === "repay") d = d > parsed ? d - parsed : 0n;
    if (d === 0n) return SCALE * 1_000_000_000n;
    const cv = (c * sp) / SCALE;
    const adj = (cv * BigInt(POOL_PARAMS.liqThresholdBps)) / 10_000n;
    return (adj * SCALE) / d;
  }
  const post = parsed > 0n ? postHf() : undefined;
  const postNum = hfNumber(post);
  const unsafe =
    (tab === "borrow" || tab === "withdraw") && postNum !== null && postNum < 1 && parsed > 0n;

  const method = {
    supply: "supply_collateral",
    borrow: "borrow",
    repay: "repay",
    withdraw: "withdraw_collateral",
  }[tab];
  const argName = tab === "supply" || tab === "withdraw" ? "shares" : "amount";

  async function act() {
    if (parsed <= 0n) return;
    await submit({
      kind: "pool",
      contractId: env.MINI_POOL,
      method,
      args: [addr(wallet.address!), i128(parsed)],
      label: tab[0].toUpperCase() + tab.slice(1),
      invalidate: ["position", "hf", "vaultBalance", "tokenBalance"],
    });
    setAmount("");
  }

  const empty = !wallet.address || (coll === 0n && debt === 0n);

  return (
    <div className="col" style={{ gap: 24 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: 32 }}>
        Borrow against ld-shares
      </h1>
      <div className="row" style={{ gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Left — position + HF */}
        <div style={{ flex: 1, minWidth: 320 }}>
          <LedgerPanel
            empty={empty}
            emptyCopy="No position yet — supply ld-shares to begin. This ledger is asleep."
            title="Your position"
          >
            <div className="row between" style={{ marginTop: 8 }}>
              <div>
                <div className="label">Collateral (ldLEOD)</div>
                <div className="fig sm">{amt(coll)}</div>
                <div className="label">≈ ${amt(collValue, 2)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="label">Debt (USDC)</div>
                <div className="fig sm">{amt(debt)}</div>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <HealthGauge hf={hf.data} />
            </div>
            <div className="row between" style={{ marginTop: 12 }}>
              <span className="label">Max borrow remaining</span>
              <span className="mono">{amt(maxBorrow > 0n ? maxBorrow : 0n)} USDC</span>
            </div>
            <div className="label mono" style={{ marginTop: 10, fontSize: 10 }}>
              LTV {POOL_PARAMS.ltvBps / 100}% · liq threshold {POOL_PARAMS.liqThresholdBps / 100}% ·
              bonus {POOL_PARAMS.liqBonusBps / 100}%
            </div>
          </LedgerPanel>
        </div>

        {/* Right — actions */}
        <div className="panel" style={{ flex: 1, minWidth: 320 }}>
          <div className="tabs">
            {(["supply", "borrow", "repay", "withdraw"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="label">
            {tab === "supply" || tab === "withdraw" ? "ldLEOD shares" : "USDC amount"}
          </div>
          <div className="row center" style={{ gap: 10 }}>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            />
            <span className="label mono">{argName}</span>
          </div>

          {parsed > 0n && post !== undefined && (
            <div className="label mono" style={{ marginTop: 12 }}>
              HF {hfNumber(hf.data)?.toFixed(2) ?? "—"} → {postNum?.toFixed(2) ?? "—"}
            </div>
          )}
          {unsafe && (
            <div className="monoblock" style={{ marginTop: 10 }}>
              That would push your health factor below 1 — the pool will reject it.
            </div>
          )}
          <div className="label" style={{ marginTop: 8 }}>
            Wallet: {amt(ldBal.data)} ldLEOD · {amt(usdcBal.data)} USDC
          </div>

          <button
            type="button"
            className="btn solid"
            style={{ marginTop: 16, width: "100%" }}
            disabled={!wallet.address || parsed <= 0n || unsafe}
            onClick={act}
          >
            {!wallet.address ? "Connect wallet" : tab}
          </button>
        </div>
      </div>
    </div>
  );
}
