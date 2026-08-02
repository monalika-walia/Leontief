import { useEffect, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { useApp } from "../ctx";

/**
 * Telegram link ceremony (A8 Tier 1).
 *
 * The bot mints a one-time code and sends the user here. With a wallet already
 * connected, the app fetches the exact challenge text from the backend, shows it
 * verbatim, and asks the wallet to sign it (SEP-53). The backend verifies the
 * signature against the claimed address and binds chat ↔ address.
 *
 * What this is NOT: it is not a transaction, it grants no permission, and it
 * moves nothing. The bot never receives a key — after this, it can read public
 * chain data for the address and message you about it. That is the whole grant.
 */
type Phase =
  | { at: "idle" }
  | { at: "loading" }
  | { at: "ready"; challenge: string }
  | { at: "signing"; challenge: string }
  | { at: "done"; method: string }
  | { at: "error"; message: string };

const CODE = /^[A-Z0-9]{8}$/;

export function Link() {
  const [params] = useSearchParams();
  const { env, wallet } = useApp();
  const code = (params.get("code") ?? "").toUpperCase();
  const [phase, setPhase] = useState<Phase>({ at: "idle" });

  const valid = CODE.test(code);
  const api = env.INDEXER_URL;

  // Fetch the challenge only once both the code and an address are in hand —
  // the text is bound to that exact pair.
  useEffect(() => {
    if (!valid || !wallet.address) return;
    let cancelled = false;
    setPhase({ at: "loading" });
    fetch(`${api}/tg/challenge?code=${encodeURIComponent(code)}&address=${wallet.address}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`challenge unavailable (${r.status})`);
        return (await r.json()) as { challenge: string };
      })
      .then((d) => {
        if (!cancelled) setPhase({ at: "ready", challenge: d.challenge });
      })
      .catch((e: Error) => {
        if (!cancelled) setPhase({ at: "error", message: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [api, code, valid, wallet.address]);

  async function sign() {
    if (phase.at !== "ready" || !wallet.signMessage || !wallet.address) return;
    const { challenge } = phase;
    setPhase({ at: "signing", challenge });
    try {
      const signature = await wallet.signMessage(challenge);
      const res = await fetch(`${api}/tg/link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, address: wallet.address, signature, method: "signature" }),
      });
      const body = (await res.json()) as { ok?: boolean; method?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `link failed (${res.status})`);
      setPhase({ at: "done", method: body.method ?? "signature" });
    } catch (e) {
      setPhase({ at: "error", message: (e as Error).message });
    }
  }

  if (!valid) {
    return (
      <Frame title="That link is missing its code">
        <p className="dim">
          Run <span className="mono">/link</span> in the Leontief bot to get a fresh one. Codes
          expire after 15 minutes and work once.
        </p>
      </Frame>
    );
  }

  if (!wallet.address) {
    return (
      <Frame title="Connect the wallet you want to link">
        <p className="dim">
          Code <span className="mono">{code}</span> is waiting. Connect a wallet, then sign a short
          message to prove the address is yours.
        </p>
        <button
          type="button"
          className="btn solid"
          style={{ marginTop: 18 }}
          onClick={wallet.connect}
        >
          {wallet.connecting ? "Connecting…" : "Connect wallet"}
        </button>
      </Frame>
    );
  }

  if (phase.at === "done") {
    return (
      <Frame title="Linked">
        <p className="dim">
          Telegram is now bound to this address (verified by{" "}
          {phase.method === "memo" ? "an on-chain payment" : "message signature"}). Head back to the
          bot — <span className="mono">/health</span> and <span className="mono">/alerts</span> are
          live.
        </p>
        <p className="dim" style={{ marginTop: 12 }}>
          The bot can read your public position and message you. It cannot move funds, and it never
          received a key.
        </p>
      </Frame>
    );
  }

  return (
    <Frame title="Prove this address is yours">
      <p className="dim">
        Signing the message below binds Telegram chat code <span className="mono">{code}</span> to{" "}
        <span className="mono">
          {wallet.address.slice(0, 6)}…{wallet.address.slice(-6)}
        </span>
        .
      </p>
      <p className="dim" style={{ marginTop: 8 }}>
        This is a message signature, not a transaction. It authorizes nothing, spends nothing, and
        can't be replayed anywhere else.
      </p>

      {phase.at === "loading" && (
        <div className="label" style={{ marginTop: 18 }}>
          Fetching the challenge…
        </div>
      )}

      {(phase.at === "ready" || phase.at === "signing") && (
        <>
          <div className="monoblock" style={{ marginTop: 18, whiteSpace: "pre-wrap" }}>
            {phase.challenge}
          </div>
          <button
            type="button"
            className="btn solid"
            style={{ marginTop: 18, width: "100%" }}
            disabled={phase.at === "signing" || !wallet.signMessage}
            onClick={sign}
          >
            {phase.at === "signing" ? "Waiting for your wallet…" : "Sign this message"}
          </button>
          {!wallet.signMessage && (
            <p className="dim" style={{ marginTop: 12 }}>
              This wallet can't sign messages. Send yourself a 0-XLM payment with{" "}
              <span className="mono">{code}</span> as the text memo, then return here — the backend
              accepts that as proof instead.
            </p>
          )}
        </>
      )}

      {phase.at === "error" && (
        <div className="monoblock" style={{ marginTop: 18 }}>
          {phase.message}
        </div>
      )}
    </Frame>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="wrap" style={{ padding: "64px 24px", maxWidth: 620 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: 30 }}>
        {title}
      </h1>
      <div style={{ marginTop: 16 }}>{children}</div>
      <p style={{ marginTop: 28 }}>
        <NavLink to="/positions">← your positions</NavLink>
      </p>
    </div>
  );
}
