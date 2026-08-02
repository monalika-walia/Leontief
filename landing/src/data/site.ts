/** Single source of truth for every absolute URL the blog emits. */
export const SITE = {
  origin: "https://leontief.tech",
  name: "Leontief",
  legalName: "Leontief",
  /** Root-shell title — A9 Phase 1.1. */
  title: "Leontief — Put tokenized treasuries to work on Stellar",
  description:
    "Leontief wraps restricted real-world assets on Stellar into composable ld-shares — still earning, now working. A testnet prototype by 29Projects Lab.",
  blogTitle: "Leontief Blog",
  blogDescription:
    "Plainspoken notes on real-world assets, permissioned collateral, and fail-closed oracle design on Stellar.",
  publisher: "29Projects Lab",
  app: "https://app.leontief.tech",
  docs: "https://docs.leontief.tech",
  litepaper: "https://leontief.tech/litepaper",
  performance: "https://leontief.tech/performance",
  github: "https://github.com/monalika-walia/Leontief",
} as const;

export const url = (path: string) =>
  path === "/" ? `${SITE.origin}/` : `${SITE.origin}${path.startsWith("/") ? path : `/${path}`}`;

/** Docs pages posts are allowed to cite as their "1 docs page" internal link. */
export const DOCS = {
  overview: `${SITE.docs}/overview`,
  architecture: `${SITE.docs}/architecture`,
  vault: `${SITE.docs}/protocol/vault`,
  oracle: `${SITE.docs}/protocol/oracle-adapter`,
  security: `${SITE.docs}/security`,
  addresses: `${SITE.docs}/addresses`,
  sdk: `${SITE.docs}/sdk`,
  demo: `${SITE.docs}/demo`,
  reflector: `${SITE.docs}/integrations/reflector`,
  blend: `${SITE.docs}/integrations/blend`,
} as const;
