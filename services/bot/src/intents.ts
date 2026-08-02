// Deep-link intents. The bot's action commands NEVER execute anything: they
// reply with a link into the dApp, where the user signs in their own wallet.
//
// This module builds those links and is the single place that decides what a
// valid intent looks like. The app validates the same shape again on arrival
// (app/src/lib/intent.ts) — belt and braces, because a link can be edited by
// hand or forwarded by a stranger.
export const INTENT_ACTIONS = ["wrap", "unwrap", "supply", "borrow", "repay"] as const;
export type IntentAction = (typeof INTENT_ACTIONS)[number];

export function isIntentAction(s: string): s is IntentAction {
  return (INTENT_ACTIONS as readonly string[]).includes(s);
}

/** Asset symbols are short uppercase codes (the oracle feed key). */
const ASSET = /^[A-Z0-9]{1,12}$/;
/** Up to 15 integer digits and 7 decimals — the contract's own precision. */
const AMOUNT = /^\d{1,15}(\.\d{1,7})?$/;

export type Intent = { action: IntentAction; asset?: string; amt?: string };

/**
 * Build an app deep link. Returns null rather than a half-valid URL: a bad
 * amount should surface as a bot error the user can read, not as a prefilled
 * field they might confirm.
 */
export function intentUrl(appBase: string, intent: Intent): string | null {
  if (!isIntentAction(intent.action)) return null;
  if (intent.asset !== undefined && !ASSET.test(intent.asset)) return null;
  if (intent.amt !== undefined && (!AMOUNT.test(intent.amt) || Number(intent.amt) <= 0))
    return null;

  const url = new URL("/intent", appBase.endsWith("/") ? appBase : `${appBase}/`);
  url.searchParams.set("action", intent.action);
  if (intent.asset) url.searchParams.set("asset", intent.asset);
  if (intent.amt) url.searchParams.set("amt", intent.amt);
  return url.toString();
}

/** The sentence that ships with every intent link. Non-negotiable copy: the
 *  user must know the bot cannot move funds before they tap anything. */
export const INTENT_FOOTER =
  "This link only opens the app with the fields filled in. " +
  "Nothing is submitted until you review it and sign in your own wallet.";
