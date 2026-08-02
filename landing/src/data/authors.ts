/**
 * Real bylines only — A9 Phase 4 E-E-A-T. A named human edits, fact-checks every
 * figure against its linked source, and owns the byline; drafts may be AI-assisted.
 *
 * `url` is the profile a byline links to. It is optional on purpose: emitting a
 * link we cannot verify would be worse than emitting none, and schema.org Person
 * is valid without one. Fill in Aditya's and Vyom's handles when they join the
 * repo (same TODO as CODEOWNERS).
 */
export type Author = {
  id: string;
  name: string;
  role: string;
  bio: string;
  url?: string;
};

const BYLINES = {
  monalika: {
    id: "monalika",
    name: "Monalika Walia",
    role: "Protocol lead",
    bio: "Protocol lead at Leontief. Writes the vault accounting and the share-price math, and owns the frozen prototype spec.",
    url: "https://github.com/monalika-walia",
  },
  aditya: {
    id: "aditya",
    name: "Aditya",
    role: "Contracts & risk",
    bio: "Contracts and risk at Leontief. Built the fail-closed oracle adapter, the mini-pool, and the permissioned-liquidation path.",
  },
  vyom: {
    id: "vyom",
    name: "Vyom",
    role: "Full-stack",
    bio: "Full-stack at Leontief. Builds the app, the indexer, and the deployment and monitoring runbooks.",
  },
} as const;

export type AuthorId = keyof typeof BYLINES;

// Widened to `Author` on the way out: the `as const` above gives us the key union,
// but leaves `url` absent from the literal type of a byline that has no profile yet.
export const AUTHORS: Record<AuthorId, Author> = BYLINES;

export const authorIds = Object.keys(BYLINES) as AuthorId[];
