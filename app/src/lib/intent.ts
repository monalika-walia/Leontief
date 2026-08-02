import { z } from "zod";

// Deep-link intents arriving from the Telegram bot (or a forwarded link, or a
// hand-edited URL — treat all three the same). The bot validates before it
// builds a link; this validates again on arrival, because a link is user input.
//
// An intent PREFILLS a panel. It never submits: the user still reviews the
// numbers and signs in their own wallet, exactly as if they had typed them.
export const INTENT_ACTIONS = ["wrap", "unwrap", "supply", "borrow", "repay"] as const;
export type IntentAction = (typeof INTENT_ACTIONS)[number];

const schema = z.object({
  action: z.enum(INTENT_ACTIONS),
  asset: z
    .string()
    .regex(/^[A-Z0-9]{1,12}$/)
    .optional(),
  amt: z
    .string()
    .regex(/^\d{1,15}(\.\d{1,7})?$/)
    .refine((s) => Number(s) > 0, "amount must be positive")
    .optional(),
});

export type Intent = z.infer<typeof schema>;
export type IntentParse = { ok: true; intent: Intent } | { ok: false; problems: string[] };

export function parseIntent(params: URLSearchParams): IntentParse {
  const raw = {
    action: params.get("action") ?? undefined,
    asset: params.get("asset") ?? undefined,
    amt: params.get("amt") ?? undefined,
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => `${i.path.join(".") || "intent"}: ${i.message}`),
    };
  }
  return { ok: true, intent: parsed.data };
}

/** Which panel handles an action, and how it seeds that panel's own state. */
export function intentTarget(intent: Intent, vaultId: string): string {
  const q = new URLSearchParams();
  if (intent.amt) q.set("amt", intent.amt);
  const query = q.toString() ? `?${q}` : "";

  switch (intent.action) {
    case "wrap":
    case "unwrap":
      return `/vaults/${vaultId}${query}${query ? "&" : "?"}tab=${intent.action}`;
    case "supply":
    case "borrow":
    case "repay":
      return `/borrow${query}${query ? "&" : "?"}tab=${intent.action}`;
  }
}

/** Read a prefill amount a panel was handed. Invalid values are ignored rather
 *  than shown — a panel should never display a number it would refuse. */
export function prefillAmount(params: URLSearchParams): string {
  const amt = params.get("amt");
  if (!amt) return "";
  return /^\d{1,15}(\.\d{1,7})?$/.test(amt) && Number(amt) > 0 ? amt : "";
}

export function prefillTab<T extends string>(
  params: URLSearchParams,
  allowed: readonly T[],
): T | null {
  const tab = params.get("tab");
  return tab && (allowed as readonly string[]).includes(tab) ? (tab as T) : null;
}
