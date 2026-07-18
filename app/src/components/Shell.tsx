import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useApp } from "../ctx";
import { shortAddr } from "../lib/format";
import { useToasts } from "./TxToast";

export function Shell({ children, demoEnabled }: { children: ReactNode; demoEnabled: boolean }) {
  const { env, wallet } = useApp();
  const { busy } = useToasts();
  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <NavLink to="/vaults" className="wordmark">
            Leontief
          </NavLink>
          <nav className="nav">
            <NavLink to="/vaults">Markets</NavLink>
            <NavLink to="/borrow">Borrow</NavLink>
            <NavLink to="/positions">Positions</NavLink>
            <NavLink to="/stats">Stats</NavLink>
            <NavLink to="/liquidate">Liquidate</NavLink>
            <NavLink to="/issuer">Issuer</NavLink>
            {demoEnabled && <NavLink to="/demo">Demo</NavLink>}
          </nav>
          <div className="row center" style={{ gap: 12 }}>
            <span className="chip inv">Testnet</span>
            {wallet.address ? (
              <button type="button" className="btn" onClick={wallet.disconnect}>
                {shortAddr(wallet.address)}
              </button>
            ) : (
              <button
                type="button"
                className="btn solid"
                onClick={wallet.connect}
                disabled={wallet.connecting}
              >
                {wallet.connecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="wrap" style={{ padding: "36px 24px 120px" }}>
        {children}
      </main>

      <footer className="wrap" style={{ borderTop: "1px solid var(--hair)", padding: "24px" }}>
        <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
          <span className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            <span className="label">a 29Projects Lab protocol</span>
            <a
              className="label mono"
              href="https://docs.leontief.tech"
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: "underline" }}
            >
              docs ↗
            </a>
          </span>
          <span className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            {[
              ["vault", env.VAULT_LEOD],
              ["pool", env.MINI_POOL],
              ["adapter", env.ORACLE_ADAPTER],
            ].map(([name, id]) => (
              <a
                key={name}
                className="label mono"
                href={`${env.EXPLORER_BASE}/contract/${id}`}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: "underline" }}
              >
                {name} ↗
              </a>
            ))}
          </span>
        </div>
      </footer>

      <div className="seal">
        <span className={`dot ${busy ? "busy" : ""}`} aria-hidden />
        {busy ? "SIGNING · TESTNET" : "ACTIVE · TESTNET"}
      </div>
    </>
  );
}
