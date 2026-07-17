import { useEffect, useState } from "react";

// Session tx log — memory only (never localStorage for financial data). Cleared
// on reload. A tiny pub/sub so any component can subscribe.
export type LogEntry = { id: number; type: string; detail?: string; hash: string; at: number };

const entries: LogEntry[] = [];
const subs = new Set<() => void>();
let seq = 1;

export function logTx(e: { type: string; detail?: string; hash: string }): void {
  entries.unshift({ ...e, id: seq++, at: Date.now() });
  for (const f of subs) f();
}

export function useSessionLog(): LogEntry[] {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return entries;
}
