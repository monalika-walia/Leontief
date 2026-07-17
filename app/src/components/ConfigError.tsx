/** Full-screen config error — never a blank app when env is missing. */
export function ConfigError({ missing }: { missing: string[] }) {
  return (
    <div className="config-error">
      <div style={{ maxWidth: 560 }}>
        <div className="fig">Configuration incomplete</div>
        <p className="dim" style={{ marginTop: 12 }}>
          The dApp needs these environment variables (copy them from{" "}
          <span className="mono">deploy.env</span> into <span className="mono">app/.env.local</span>
          , prefixed with <span className="mono">VITE_</span>):
        </p>
        <div className="monoblock" style={{ marginTop: 16 }}>
          {missing.join("\n")}
        </div>
      </div>
    </div>
  );
}
