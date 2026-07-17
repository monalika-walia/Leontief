import { useNavigate } from "react-router-dom";
import { useApp } from "../ctx";
import { useNav, useSharePrice, useTotalAssets, useVaultBalance, useVaultTotals } from "../hooks";
import { ageLabel, amt, scaled, shortAddr } from "../lib/format";

export function Vaults() {
  const { env, wallet } = useApp();
  const nav = useNav();
  const price = useSharePrice();
  const tvl = useTotalAssets();
  const totals = useVaultTotals();
  const bal = useVaultBalance(wallet.address);
  const navigate = useNavigate();

  const halted = nav.data && !nav.data.ok;
  const capUtil =
    totals.data?.cap && totals.data.cap > 0n && tvl.data
      ? Number((tvl.data * 100n) / totals.data.cap)
      : 0;

  return (
    <div className="col" style={{ gap: 28 }}>
      <div>
        <div className="label mono">Markets · Testnet</div>
        <h1 className="serif" style={{ margin: "6px 0 0", fontSize: 34 }}>
          Wrap restricted assets into working shares
        </h1>
      </div>

      {/* stat cells — dormant until wallet connects */}
      <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
        <Stat
          label="Total value wrapped"
          value={tvl.data !== undefined ? `$${amt(tvl.data, 2)}` : "…"}
        />
        <Stat label="Vaults live" value="1" />
        <Stat
          label="Your ld-position"
          value={wallet.address ? amt(bal.data) : "—"}
          dormant={!wallet.address}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>NAV</th>
            <th>Share price</th>
            <th>Total wrapped</th>
            <th>Cap util</th>
            <th>Your ld-balance</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr role="button" tabIndex={0} onClick={() => navigate(`/vaults/${env.VAULT_LEOD}`)}>
            <td>
              <div style={{ fontWeight: 500 }} className="mono">
                ldLEOD
              </div>
              <div className="label">Leontief Demo Bond · {shortAddr(env.LEOD_SAC)}</div>
            </td>
            <td>
              {halted ? (
                <span className="chip inv" title={nav.data && !nav.data.ok ? nav.data.reason : ""}>
                  Halted
                </span>
              ) : nav.data?.ok ? (
                <span>
                  {scaled(nav.data.nav)} <span className="label">· {ageLabel(nav.data.ts)}</span>
                </span>
              ) : (
                "…"
              )}
            </td>
            <td className="serif">{price.data !== undefined ? scaled(price.data) : "…"}</td>
            <td>{tvl.data !== undefined ? amt(tvl.data, 2) : "…"}</td>
            <td>
              <div style={{ height: 6, background: "var(--hair)", position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${capUtil}%`,
                    background: "var(--fg)",
                  }}
                />
              </div>
              <span className="label">{capUtil}%</span>
            </td>
            <td>{wallet.address ? amt(bal.data) : "—"}</td>
            <td>→</td>
          </tr>
        </tbody>
      </table>
      {halted && (
        <div className="monoblock">
          Price feed halted rather than guessing — funds are safe, wrap/borrow actions are
          unavailable until a fresh NAV arrives. (reason:{" "}
          {nav.data && !nav.data.ok ? nav.data.reason : ""})
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, dormant }: { label: string; value: string; dormant?: boolean }) {
  return (
    <div
      className={`panel ${dormant ? "dormant dormant-panel" : ""}`}
      style={{ flex: 1, minWidth: 200, background: "var(--bg)", color: "var(--fg)" }}
    >
      <div className="label">{label}</div>
      <div className="fig" style={{ marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}
