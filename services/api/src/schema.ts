import { z } from "zod";

/**
 * Early-access signup payload. Mirrors the landing modal fields (landing.html):
 * a required email plus optional role, assets of interest, and a social handle.
 * Every non-email field is optional so the form can shrink or grow freely.
 */
export const earlyAccessSchema = z.object({
  email: z.string().email().max(254),
  // "Asset holder" | "Issuer" | "Builder" | "Investor" | "Just curious"
  role: z.string().trim().max(60).optional(),
  // Assets the signup holds or issues (USDY, CETES, …) — GTM signal.
  assets: z.array(z.string().trim().max(60)).max(20).optional(),
  // Telegram/X handle, free-form.
  handle: z.string().trim().max(120).optional(),
  source: z.string().trim().max(60).default("landing"),
  // Honeypot: bots fill hidden fields, humans leave them empty.
  website: z.string().max(0).optional(),
});

export type EarlyAccess = z.infer<typeof earlyAccessSchema>;
