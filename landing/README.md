# landing/

Everything served from `leontief.tech`, in one Vercel project: the cinematic
"dormant → awake" landing page (docs-hub §09), the litepaper, the live performance
dashboard, and — since A9 — the blog and the whole crawl surface.

It is an **Astro project**. Astro copies `public/` verbatim, so the three hand-built
pages ship byte-identical to how they were designed; Astro itself only owns `/blog`,
`sitemap.xml`, `/blog/rss.xml`, and the generated OG cards. See `DECISIONS.md` #8.

```
landing/
├── public/                     copied verbatim to the deploy root
│   ├── index.html              the landing page (self-contained, inline CSS/JS)
│   ├── landing.html            byte mirror of index.html; canonicalizes to /
│   ├── Litepaper.dc.html       the litepaper — /litepaper rewrites here
│   ├── performance.html        live testnet dashboard — /performance rewrites here
│   ├── config.js               sets window.LEONTIEF.API_BASE for the early-access form
│   ├── robots.txt · favicon.svg
│   └── fonts/                  self-hosted latin subsets (58 KB total)
├── src/
│   ├── content/blog/*.md       the posts
│   ├── content.config.ts       binding frontmatter schema
│   ├── pages/                  /blog, /blog/<slug>, rss.xml, sitemap.xml, /og/<slug>.png
│   ├── layouts/ components/    the reading room
│   ├── lib/jsonld.ts           JSON-LD builders, typed against schema-dts
│   ├── lib/og.ts               one branded OG template (satori + resvg)
│   ├── styles/blog.css         tokens inherited from docs/DESIGN-TOKENS.md
│   └── assets/fonts/           build-time TTFs for the OG cards (not served)
├── api/performance.js          Vercel serverless read-API for the dashboard
└── scripts/                    the A9 gate: seo-check, lighthouse-check
```

## Run locally

```sh
cd landing
npm install
npm run dev          # → http://localhost:4321  (landing at /, blog at /blog)

npm run verify       # build + the full SEO/editorial gate
npm run lighthouse   # budget audit (needs Chrome)
```

From the repo root: `just landing`, `just blog-build`, `just blog-check`.

## Writing a post

`landing/src/content/blog/<slug>.md`, frontmatter per `src/content.config.ts`. The
rules, the checklist, and what CI enforces are in [docs/SEO.md](../docs/SEO.md).
Design tokens are inventoried in [docs/DESIGN-TOKENS.md](../docs/DESIGN-TOKENS.md) —
the blog adds no hues of its own.

## Design provenance

`index.html` is the imported Claude Design (`landing.html` from the shared Design
project), with three intentional changes:

1. **Branding** — footer reads *"a 29Projects Lab protocol"* (was "XXIX Labs").
2. **Backend wiring** — the early-access modal POSTs to the API (below), with a
   honeypot field and an offline-safe `localStorage` fallback.
3. **Crawl surface (A9)** — the `<title>` is now the A9 line, and the head carries
   canonical, OG/Twitter, and `Organization` + `WebSite` JSON-LD. No visible copy,
   layout, or canvas behaviour was touched. If this page is ever re-exported from the
   design tool, that head block has to be carried across — `scripts/seo-check.mjs`
   fails the build if it goes missing.

> Note: the design's `Litepaper.dc.html` was delivered in the Claude Design *bundler*
> format (`<x-dc>` / `<helmet>` / `support.js` runtime) and could not be fetched whole
> in the build environment. The `Litepaper.dc.html` here is a complete, self-contained
> rebuild in the same visual language, with content sourced from
> `leontief-business-plan.md`, `leontief-docs-hub.md`, and the frozen spec. Swap it for
> the official bundler export once it can be imported interactively (`/design-login` in
> an interactive session).

## Early-access form → backend

The form submits `{ email, role, assets[], handle, source }` to
`${API_BASE}/early-access` (see [services/api](../services/api)). Behavior:

- `API_BASE` empty → local-only mode (saves to `localStorage`, still confirms).
- Backend reachable → row upserted by email; the user sees confirmation.
- Backend unreachable → the `localStorage` copy is kept and the user is still
  confirmed (no lost signups, no dead button).

## Deploy

Vercel project `leontief-landing`, Root Directory `landing/`. `vercel.json` carries the
build command, the output directory, the `/litepaper` and `/performance` rewrites, and
the immutable cache headers for fonts and OG images — no dashboard settings are
required. Override the API origin at deploy time via `config.js`:

```js
window.LEONTIEF = { API_BASE: "https://api.leontief.app" };
```
