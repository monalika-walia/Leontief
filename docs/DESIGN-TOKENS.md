# Design tokens — inventory

**Status:** inventoried 2026-08-02 from the shipped landing (`landing/public/index.html`,
commit `ff806c6` + `7c76662`). The A8-L phase-1 inventory this file stands in for was
never committed, so the deployed page is the source of truth and this document
records it. Anything built on top of the brand — the blog, future pages, OG images —
reads from here rather than re-picking values by eye.

**Rule:** no new hues. A surface that needs a colour the landing does not use is a
design decision, not an implementation detail; it goes through `DECISIONS.md` first.

## Colour

| Token | Value | Role |
|---|---|---|
| `--bg` | `#17130c` | The ground. Near-black warm brown; every dark surface is this exact value. |
| `--fg` | `#f5efe3` | Ink. Warm off-white; body text, rules, marks. |
| `--accent` | `#c9a24b` | Brass. Links on hover, the ledger rule, one emphasis per view — never a fill. |
| `--line` | `color-mix(in oklab, var(--fg) 15%, transparent)` | Hairline between sections. |
| `--line-soft` | `color-mix(in oklab, var(--fg) 8%, transparent)` | Hairline inside a section (table rows, byline). |

Flattened equivalents, for contexts without `color-mix()` (satori, OG images):
`--line` over `--bg` ≈ `#3a352c`.

The landing is dark-only. The litepaper (`Litepaper.dc.html`) inverts to paper
(`#F2F1ED` ground, `#0E0E0C` ink) and is the only light surface in the system; it
is a document, not a page, and does not share this scale.

## Type

| Token | Value |
|---|---|
| `--serif` | `"Newsreader", Georgia, serif` — all prose, all headings |
| `--mono` | `"IBM Plex Mono", ui-monospace, monospace` — kickers, metadata, figures, labels |

Weights in use: Newsreader 400 (prose) and 500–600 (headings, marks); IBM Plex Mono 400.
Both faces are SIL OFL 1.1. The landing loads them from the Google CDN; the blog
self-hosts a latin subset (`landing/public/fonts/`, 58 KB total) so the reading
surface has one origin on the critical path.

**Numerals are tabular everywhere** (`font-variant-numeric: tabular-nums`). A ledger
that reflows its columns when a digit changes is not a ledger.

### Measurements observed on the landing

- Mono kickers: `10.5px`, `letter-spacing: 0.34em`, uppercase, `opacity: 0.55` — the
  dominant kicker. Secondary variants at `0.2em` / `0.14em` for denser metadata rows.
- Display headings: `letter-spacing: -0.015em`, `line-height` ≈ 1.1.
- Body de-emphasis is opacity, not a second grey: `0.78` (standfirst), `0.6`–`0.7`
  (secondary), `0.5`–`0.55` (labels), `0.42`–`0.45` (fine print).

## Rhythm

- Section gutter: `clamp(20px, 4–5vw, 44px)`.
- Reading measure: **~68ch**. The landing is a wide cinematic surface; the blog is a
  column, and that is the only structural difference between them.
- Sections are separated by a **ruled hairline**, never by a card, shadow, or fill.
  There are no rounded rectangles in the content area — the only radius in the system
  is the 8px on the `L` mark.

## Imagery

There is none, by policy. The landing's visual is a canvas rendered at runtime; the
blog's only imagery is the generated OG card (`landing/src/lib/og.ts`), which draws
the title and kicker on the ledger ground using the tokens above. Posts carry no hero
images and no stock photography.

## Where these live in code

| Surface | File |
|---|---|
| Landing | `landing/public/index.html` (inline, self-contained) |
| Blog | `landing/src/styles/blog.css` (`:root`) |
| OG cards | `landing/src/lib/og.ts` (`TOKENS`) |
| App | `app/src/**` — inherits the palette, different type scale (IBM Plex Sans) |
