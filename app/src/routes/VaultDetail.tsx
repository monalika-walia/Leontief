import { Keypair } from "@stellar/stellar-sdk";
import { useState } from "react";
import { useApp } from "../ctx";
import { useNav, useSharePrice, useTokenBalance, useVaultBalance } from "../hooks";
import { addr, i128 } from "../lib/chain";
import { humanError } from "../lib/errors";
import { amt, SCALE, STROOP, scaled } from "../lib/format";
import { submitTx } from "../lib/submitTx";
import { useSubmit } from "../lib/useSubmit";

export function VaultDetail() {
  const { env, wallet, chain } = useApp();
  const nav = useNav();
  const price = useSharePrice();
  const leodBal = useTokenBalance(env.LEOD_SAC, wallet.address, "leod");
  const ldBal = useVaultBalance(wallet.address);
  const submit = useSubmit();

  const [tab, setTab] = useState<"wrap" | "unwrap">("wrap");
  const [amount, setAmount] = useState("");
  const [restrictionMsg, setRestrictionMsg] = useState<string | null>(null);
  const [restrictionBusy, setRestrictionBusy] = useState(false);

  const halted = nav.data && !nav.data.ok;
  const parsed = (() => {
    try {
      if (!amount) return 0n;
      const [w, f = ""] = amount.split(".");
      return BigInt(w) * STROOP + BigInt((f + "0000000").slice(0, 7));
    } catch {
      return 0n;
    }
  })();

  // Preview quote from share_price (labelled ≈; the mint is exact on-chain).
  const quoteShares =
    tab === "wrap" && nav.data?.ok && price.data && price.data > 0n && parsed > 0n
      ? (parsed * nav.data.nav) / price.data
      : tab === "unwrap" && price.data && parsed > 0n
        ? (parsed * price.data) / SCALE
        : 0n;

  async function tryRestrictedSend() {
    if (!wallet.signer) {
      setRestrictionMsg("Connect a wallet holding LEOD to try this.");
      return;
    }
    setRestrictionBusy(true);
    setRestrictionMsg(null);
    try {
      const stranger = Keypair.random().publicKey();
      await submitTx(chain, wallet.signer, env.LEOD_SAC, "transfer", [
        addr(wallet.address!),
        addr(stranger),
        i128(1n * STROOP),
      ]);
      setRestrictionMsg("Unexpected: the transfer SUCCEEDED. The restriction is not enforced.");
    } catch (e) {
      setRestrictionMsg(humanError("sac", e));
    } finally {
      setRestrictionBusy(false);
    }
  }

  async function doWrap() {
    if (parsed <= 0n) return;
    await submit({
      kind: "vault",
      contractId: env.VAULT_LEOD,
      method: tab === "wrap" ? "deposit" : "withdraw",
      args: [addr(wallet.address!), i128(parsed)],
      label: tab === "wrap" ? "Wrap" : "Unwrap",
      invalidate: ["vaultBalance", "tokenBalance", "sharePrice", "totalAssets", "vaultTotals"],
    });
    setAmount("");
  }

  return (
    <div className="col" style={{ gap: 24 }}>
      <div>
        <div className="label mono">ldLEOD vault · {env.VAULT_LEOD.slice(0, 6)}…</div>
        <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 32 }}>
          Wrap LEOD → ldLEOD
        </h1>
      </div>

      <div className="row" style={{ gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Left — restriction demo (beat 1) */}
        <div className="panel" style={{ flex: 1, minWidth: 320 }}>
          <h3>This asset is SEP-8 transfer-restricted</h3>
          <p className="dim" style={{ fontSize: 14 }}>
            LEOD is issued with <span className="mono">auth_required</span>. It can't be sent to an
            un-authorized address. See for yourself.
          </p>
          <button
            type="button"
            className="btn"
            onClick={tryRestrictedSend}
            disabled={restrictionBusy}
            style={{ marginTop: 10 }}
          >
            {restrictionBusy ? "Sending…" : "Try sending 1 LEOD to a random address"}
          </button>
          {restrictionMsg && (
            <div className="monoblock" style={{ marginTop: 14 }}>
              {restrictionMsg}
              {"\n\n→ Now wrap it through the authorized vault, on the right."}
            </div>
          )}
        </div>

        {/* Right — wrap panel */}
        <div className="panel" style={{ flex: 1, minWidth: 320 }}>
          <div className="tabs">
            <button
              type="button"
              className={tab === "wrap" ? "active" : ""}
              onClick={() => setTab("wrap")}
            >
              Wrap
            </button>
            <button
              type="button"
              className={tab === "unwrap" ? "active" : ""}
              onClick={() => setTab("unwrap")}
            >
              Unwrap
            </button>
          </div>

          <div className="label">{tab === "wrap" ? "LEOD to wrap" : "ldLEOD to unwrap"}</div>
          <div className="row center" style={{ gap: 10 }}>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            />
            <button
              type="button"
              className="btn"
              onClick={() =>
                setAmount(amt(tab === "wrap" ? leodBal.data : ldBal.data, 7).replace(/,/g, ""))
              }
            >
              Max
            </button>
          </div>

          <div className="label mono" style={{ marginTop: 12 }}>
            {tab === "wrap"
              ? `You mint ≈ ${amt(quoteShares)} ldLEOD`
              : `You receive ≈ ${amt(quoteShares)} LEOD`}
          </div>
          <div className="label" style={{ marginTop: 4 }}>
            Share price {price.data !== undefined ? scaled(price.data) : "…"} · balance{" "}
            {tab === "wrap" ? amt(leodBal.data) : amt(ldBal.data)}
          </div>

          <button
            type="button"
            className="btn solid"
            style={{ marginTop: 18, width: "100%" }}
            disabled={!!halted || parsed <= 0n || !wallet.address}
            onClick={doWrap}
          >
            {!wallet.address
              ? "Connect wallet"
              : halted
                ? "Pricing halted"
                : tab === "wrap"
                  ? "Wrap"
                  : "Unwrap"}
          </button>

          <div className="row between" style={{ marginTop: 16 }}>
            <div>
              <div className="label">LEOD</div>
              <div className="mono">{amt(leodBal.data)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="label">ldLEOD</div>
              <div className="mono">{amt(ldBal.data)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
