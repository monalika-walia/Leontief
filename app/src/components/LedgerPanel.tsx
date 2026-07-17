import type { ReactNode } from "react";

/**
 * A panel that renders in the dormant (ink) state with a breathing copy line
 * while empty, then flips to awake (paper) when it has content. The brand's
 * "ledger asleep → awake" behavior, reusable.
 */
export function LedgerPanel({
  empty,
  emptyCopy,
  title,
  children,
}: {
  empty: boolean;
  emptyCopy: string;
  title?: string;
  children: ReactNode;
}) {
  if (empty) {
    return (
      <div
        className="panel dormant dormant-panel"
        style={{ background: "var(--bg)", color: "var(--fg)" }}
      >
        {title && <h3>{title}</h3>}
        <p className="dim" style={{ margin: title ? "8px 0 0" : 0 }}>
          {emptyCopy}
        </p>
      </div>
    );
  }
  return (
    <div className="panel">
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}
