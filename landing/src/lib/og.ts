/**
 * One branded OG template, rendered at build time (A9 Phase 1.4). Title + kicker
 * on the ledger ground, drawn from the inventoried A8-L tokens — no manual image
 * work per post, and no hero images anywhere else on the blog.
 *
 * satori lays the card out and emits SVG with the glyphs already flattened to
 * paths, so resvg rasterises it without needing the fonts a second time.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

const TOKENS = {
  bg: "#17130c",
  fg: "#f5efe3",
  accent: "#c9a24b",
  line: "#3a352c", // fg at 15% over bg, flattened — satori has no color-mix()
} as const;

// Resolved off the project root, not `import.meta.url`: this module is bundled
// into a prerender chunk under dist/, so a URL relative to the module would point
// at a directory Vite never copies. `astro build` and `astro dev` both run with
// cwd = the Astro project root, which is this directory.
const FONT_DIR = join(process.cwd(), "src", "assets", "fonts");

const font = (file: string) => readFileSync(join(FONT_DIR, file));

const FONTS = [
  { name: "Newsreader", data: font("Newsreader-Regular.ttf"), weight: 400 as const, style: "normal" as const },
  { name: "Newsreader", data: font("Newsreader-SemiBold.ttf"), weight: 600 as const, style: "normal" as const },
  { name: "IBM Plex Mono", data: font("IBMPlexMono-Regular.ttf"), weight: 400 as const, style: "normal" as const },
];

export type OgCard = { kicker: string; title: string; footnote?: string };

/** Long headlines step down rather than overflow the card. */
function titleSize(title: string): number {
  if (title.length > 84) return 52;
  if (title.length > 62) return 60;
  if (title.length > 44) return 68;
  return 76;
}

const el = (type: string, style: Record<string, unknown>, children?: unknown) => ({
  type,
  props: children === undefined ? { style } : { style, children },
});

export async function renderOgPng(card: OgCard): Promise<Buffer> {
  const tree = el(
    "div",
    {
      width: 1200,
      height: 630,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      backgroundColor: TOKENS.bg,
      color: TOKENS.fg,
      padding: "64px 72px",
      borderTop: `6px solid ${TOKENS.accent}`,
      fontFamily: "Newsreader",
    },
    [
      // Kicker rail
      el(
        "div",
        { display: "flex", flexDirection: "column" },
        [
          el(
            "div",
            {
              fontFamily: "IBM Plex Mono",
              fontSize: 20,
              letterSpacing: 7,
              textTransform: "uppercase",
              color: TOKENS.accent,
            },
            card.kicker.toUpperCase(),
          ),
          el("div", {
            marginTop: 28,
            width: 96,
            height: 1,
            backgroundColor: TOKENS.line,
          }),
        ],
      ),

      // Headline
      el(
        "div",
        {
          display: "flex",
          fontSize: titleSize(card.title),
          fontWeight: 600,
          lineHeight: 1.14,
          letterSpacing: -1,
          maxWidth: 980,
        },
        card.title,
      ),

      // Ledger footer
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
        },
        [
          el("div", { width: "100%", height: 1, backgroundColor: TOKENS.line }),
          el(
            "div",
            {
              marginTop: 24,
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
              fontFamily: "IBM Plex Mono",
              fontSize: 19,
              letterSpacing: 3,
              color: TOKENS.fg,
              opacity: 0.62,
            },
            [
              el("div", { display: "flex" }, "leontief.tech"),
              el("div", { display: "flex" }, card.footnote ?? "Stellar · testnet prototype"),
            ],
          ),
        ],
      ),
    ],
  );

  const svg = await satori(tree as never, { width: 1200, height: 630, fonts: FONTS });
  return Buffer.from(
    new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng(),
  );
}
