// @ts-check
import { defineConfig } from "astro/config";

// leontief.tech is one host: the A8-L landing ships verbatim out of `public/`
// (index.html, Litepaper.dc.html, performance.html), Astro owns /blog and the
// crawl surface (sitemap.xml, rss.xml, og images). Vercel's Root Directory
// stays `landing/`; `vercel.json` points the build at `dist/`.
//
// `sitemap.xml` is a hand-rolled endpoint rather than @astrojs/sitemap — see
// DECISIONS.md #9: the integration emits sitemap-index.xml and cannot carry
// per-URL `lastmod` for the static landing pages it does not build.
export default defineConfig({
  site: "https://leontief.tech",
  build: {
    // /blog/<slug>/index.html — Vercel serves it at /blog/<slug> with cleanUrls off.
    format: "directory",
    // One less render-blocking round trip on the LCP path. The sheet is ~9 kB
    // raw / ~2.5 kB over the wire, and there is no JS bundle to compete with it.
    inlineStylesheets: "always",
  },
  trailingSlash: "never",
  // Zero client JS is a hard budget (A9 Phase 1.5). Nothing here ships a runtime;
  // prefetch is off because it would inject a script into every page.
  prefetch: false,
  devToolbar: { enabled: false },
  markdown: {
    // Keep code blocks legible on the ledger ground without a client highlighter.
    shikiConfig: { theme: "vitesse-dark", wrap: true },
  },
});
