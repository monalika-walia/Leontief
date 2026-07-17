# landing/

The public marketing site for Leontief — the cinematic "dormant → awake"
landing page (docs-hub §09) plus the litepaper, kept together so they deploy as
one static bundle.

| File | What it is |
|---|---|
| `landing.html` | The landing page. Self-contained (inline CSS/JS); fonts from Google Fonts. |
| `Litepaper.dc.html` | The litepaper — same visual system, the "awake"/paper theme. Self-contained. |
| `config.js` | Runtime config: sets `window.LEONTIEF.API_BASE` for the early-access form. |

## Design provenance

`landing.html` is the imported Claude Design (`landing.html` from the shared
Design project), with two intentional changes:

1. **Branding** — footer reads *"a 29Projects Lab protocol"* (was "XXIX Labs").
2. **Backend wiring** — the early-access modal now POSTs to the API (see below),
   with a honeypot field and an offline-safe `localStorage` fallback.

> Note: the design's `Litepaper.dc.html` was delivered in the Claude Design
> *bundler* format (`<x-dc>` / `<helmet>` / `support.js` runtime) and could not be
> fetched whole in the build environment. The `Litepaper.dc.html` here is a
> complete, self-contained rebuild in the same visual language, with content
> sourced from `leontief-business-plan.md`, `leontief-docs-hub.md`, and the
> frozen spec. Swap it for the official bundler export once it can be imported
> interactively (`/design-login` in an interactive session).

## Early-access form → backend

The form submits `{ email, role, assets[], handle, source }` to
`${API_BASE}/early-access` (see [services/api](../services/api)). Behavior:

- `API_BASE` empty → local-only mode (saves to `localStorage`, still confirms).
- Backend reachable → row upserted by email; the user sees confirmation.
- Backend unreachable → the `localStorage` copy is kept and the user is still
  confirmed (no lost signups, no dead button).

## Run locally

```sh
# 1) backend (needs Postgres — `docker compose up -d postgres` at repo root)
pnpm --filter @leontief/api migrate
pnpm --filter @leontief/api dev        # → http://localhost:8787

# 2) static site (any static server; API_BASE defaults to localhost:8787)
cd landing && python3 -m http.server 8080   # → http://localhost:8080/landing.html
```

## Deploy

Static host (Vercel/Netlify/Cloudflare Pages). Set the real API origin by
overriding `config.js` at deploy time, e.g.:

```js
window.LEONTIEF = { API_BASE: "https://api.leontief.app" };
```
