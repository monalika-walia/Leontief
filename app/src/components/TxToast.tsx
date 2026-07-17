import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

export type Toast = {
  id: number;
  kind: "ok" | "err" | "info";
  msg: string;
  href?: string;
  hrefLabel?: string;
};

type ToastCtx = {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = seq++;
    setToasts((cur) => [...cur, { ...t, id }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 9000);
  }, []);
  return (
    <Ctx.Provider value={{ toasts, push, busy, setBusy }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "err" ? "err" : ""}`}>
            {t.msg}
            {t.href && (
              <>
                {" "}
                <a href={t.href} target="_blank" rel="noreferrer">
                  {t.hrefLabel ?? "view ↗"}
                </a>
              </>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToasts(): ToastCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToasts outside ToastProvider");
  return c;
}
