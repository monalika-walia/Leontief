import { Navigate, NavLink, useSearchParams } from "react-router-dom";
import { useApp } from "../ctx";
import { intentTarget, parseIntent } from "../lib/intent";

/**
 * Landing point for `/intent?action=…&asset=…&amt=…` deep links (A8 Tier 1).
 *
 * Validates the parameters against the same schema the bot used to build them,
 * then forwards to the panel that owns the action with the fields prefilled.
 * Bad or unknown parameters get a readable error, never a crash and never a
 * half-filled form. Nothing is ever auto-submitted.
 */
export function Intent() {
  const [params] = useSearchParams();
  const { env } = useApp();
  const parsed = parseIntent(params);

  if (parsed.ok) {
    return <Navigate to={intentTarget(parsed.intent, env.VAULT_LEOD)} replace />;
  }

  return (
    <div className="wrap" style={{ padding: "64px 24px", maxWidth: 640 }}>
      <div className="fig">That link isn't something we can open</div>
      <p className="dim" style={{ marginTop: 12 }}>
        A Leontief action link needs a known action and, if it carries an amount, a positive number
        with at most seven decimals.
      </p>
      <div className="monoblock" style={{ marginTop: 16 }}>
        {parsed.problems.map((p) => (
          <div key={p}>{p}</div>
        ))}
      </div>
      <p className="dim" style={{ marginTop: 20 }}>
        If this link came from a message, treat it with suspicion — Leontief never sends links from
        outside leontief.tech.
      </p>
      <p style={{ marginTop: 20 }}>
        <NavLink to="/vaults">← open the app instead</NavLink>
      </p>
    </div>
  );
}
