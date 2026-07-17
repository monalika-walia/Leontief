import { LedgerPanel } from "../components/LedgerPanel";
import { useApp } from "../ctx";
import { usePosition, useSharePrice, useTokenBalance, useVaultBalance } from "../hooks";
import { amt, SCALE, scaled } from "../lib/format";
import { useSessionLog } from "../lib/sessionLog";

export function Positions() {
  const { env, wallet, chain } = useApp();
  const ld = useVaultBalance(wallet.address);
  const price = useSharePrice();
  const leod = useTokenBalance(env.LEOD_SAC, wallet.address, "leod");
  const usdc = useTokenBalance(env.USDC_SAC, wallet.address, "usdc");
  const pos = usePosition(wallet.address);
  const log = useSessionLog();

  const ldValue = ld.data && price.data ? (ld.data * price.data) / SCALE : undefined;

  return (
    <div className="col" style={{ gap: 24 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: 32 }}>
        Your positions
      </h1>

      <div className="row" style={{ gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <LedgerPanel
          empty={!wallet.address}
          emptyCopy="Connect a wallet to see your holdings. This ledger is asleep."
          title="Wrapped holdings"
        >
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Balance</th>
                <th>Share price</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>ldLEOD</td>
                <td>{amt(ld.data)}</td>
                <td>{price.data !== undefined ? scaled(price.data) : "…"}</td>
                <td>${amt(ldValue, 2)}</td>
              </tr>
              <tr>
                <td>LEOD (raw)</td>
                <td>{amt(leod.data)}</td>
                <td>—</td>
                <td>—</td>
              </tr>
              <tr>
                <td>USDC</td>
                <td>{amt(usdc.data)}</td>
                <td>—</td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
        </LedgerPanel>

        <div style={{ flex: 1, minWidth: 300 }}>
          <div className="panel">
            <h3>Pool position</h3>
            <div className="row between" style={{ marginTop: 10 }}>
              <div>
                <div className="label">Collateral</div>
                <div className="mono">{amt(pos.data?.collateral_shares)} ldLEOD</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="label">Debt</div>
                <div className="mono">{amt(pos.data?.debt)} USDC</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <LedgerPanel
        empty={log.length === 0}
        emptyCopy="No entries yet — your session transactions will be stamped here."
        title="Session log"
      >
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>When</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {log.map((e) => (
              <tr key={e.id}>
                <td>{e.type}</td>
                <td>{new Date(e.at).toLocaleTimeString()}</td>
                <td>
                  <a
                    href={chain.explorerTx(e.hash)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: "underline" }}
                  >
                    {e.hash.slice(0, 8)}… ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </LedgerPanel>
    </div>
  );
}
