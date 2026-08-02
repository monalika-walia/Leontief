# SEO — how the crawl surface is built, and what has to be done by hand

The blog and the technical SEO foundation are A9. Everything that can be enforced by
a machine is enforced by `landing/scripts/seo-check.mjs` and the `Blog & SEO` workflow;
everything below the fold in this file is the part a person has to do once, in a
browser, and then record here with a date.

---

## 1 · What ships where

| URL | Served from | Built by |
|---|---|---|
| `leontief.tech/` | `landing/public/index.html` | copied verbatim |
| `leontief.tech/litepaper` | `landing/public/Litepaper.dc.html` (rewrite) | copied verbatim |
| `leontief.tech/performance` | `landing/public/performance.html` (rewrite) | copied verbatim |
| `leontief.tech/blog` | `landing/src/pages/blog/index.astro` | Astro |
| `leontief.tech/blog/<slug>` | `landing/src/content/blog/<slug>.md` | Astro |
| `leontief.tech/blog/rss.xml` | `landing/src/pages/blog/rss.xml.ts` | Astro |
| `leontief.tech/sitemap.xml` | `landing/src/pages/sitemap.xml.ts` | Astro |
| `leontief.tech/robots.txt` | `landing/public/robots.txt` | copied verbatim |
| `leontief.tech/og/<slug>.png` | `landing/src/lib/og.ts` (satori + resvg) | Astro |

One Vercel project (`leontief-landing`, Root Directory `landing/`) serves all of it.
`vercel.json` sets `buildCommand: npm run build` and `outputDirectory: dist`; nothing
outside `landing/` is needed to build it. See `DECISIONS.md` #8.

`docs.leontief.tech` (Docusaurus) and `app.leontief.tech` (the dApp) are **separate
hosts with their own crawl surfaces**. A sitemap may only list URLs on the host that
serves it, so `leontief.tech/sitemap.xml` contains leontief.tech URLs only, and each
host is verified in Search Console as its own property.

## 2 · What CI enforces on every PR

`.github/workflows/blog.yml` → `landing/scripts/seo-check.mjs`, run against `dist/`:

- **Per page** — `<title>` ≤ 70 chars, meta description 50–165 chars, absolute
  canonical matching the page's own URL, full OG + Twitter set, and an `og:image`
  that actually exists in the build.
- **JSON-LD** — parses; `Organization` + `WebSite` sitewide; `Article` on every post
  with `headline`, `author` (a `Person` with a name), `datePublished`, `dateModified`,
  `image`, `publisher`, `wordCount`; `BreadcrumbList` sitewide; `FAQPage` where
  declared, with every answer also **visible in the prose** (Google's requirement).
  The builders in `src/lib/jsonld.ts` are typed against `schema-dts`, so an invalid
  property fails at type-check before it can reach the page.
- **Zero client JS** — any `<script>` other than `application/ld+json` on a blog page
  is a build failure.
- **Editorial (A9 Phase 3/4)** — 1,200–1,800 words; one cluster; in-body links to the
  app, one docs page, and two sibling posts; no exclamation marks; a banned-hype
  phrase list; every APY/APR figure labelled *illustrative* and dated in its own
  sentence; no sentence that mentions XLM alongside price or yield; a how-to that
  never says "testnet" fails; posts 2, 3, and 5 must carry an `<h2>` risks section.
- **Crawl plumbing** — `sitemap.xml` lists every post with `lastmod` equal to its
  `dateModified`; no off-host URLs; RSS carries every post; `robots.txt` points at the
  sitemap and does not disallow the site; every internal link resolves in the build;
  no orphan posts (each post is listed on `/blog` and linked from at least one other).

`--warn-only` downgrades the editorial findings so an infrastructure PR that ships no
posts stays green. Post PRs run without it.

`.github/workflows/blog.yml` → `landing/scripts/lighthouse-check.mjs` audits `/blog`
and up to three post pages on Lighthouse's default mobile/slow-4G config and fails on:
SEO < 100, Performance < 95, CLS ≥ 0.02, LCP ≥ 1500 ms, or any script evaluation time.

Run both locally:

```bash
cd landing
npm ci
npm run verify        # build + seo-check
npm run lighthouse    # needs Chrome
```

## 3 · Publishing a post

1. `landing/src/content/blog/<slug>.md` with the frontmatter in
   `landing/src/content.config.ts`. Slugs are lowercase, hyphenated, **no dates**.
2. Set `siblings: [...]` to the two posts it should link to, and link them from the
   body as well — the checker counts body links, not just the "Read next" rail.
3. Bump `updatedDate` whenever a figure is refreshed. That value drives both the
   visible `Updated` line and `<lastmod>` in the sitemap.
4. `draft: true` keeps a post out of the build, the sitemap, and the feed entirely.
5. PR description carries: target cluster, the chosen internal links, and the filled
   honesty checklist (§5).

## 4 · Manual, one-time — **not yet done**

These need a browser and ownership of the domain. Record the date in the table when
each is completed; leave it blank rather than guessing.

| Task | Where | Done on |
|---|---|---|
| Verify `leontief.tech` (DNS TXT) | Google Search Console | |
| Submit `https://leontief.tech/sitemap.xml` | GSC → Sitemaps | |
| Verify `docs.leontief.tech` as its own property | Google Search Console | |
| Submit `https://docs.leontief.tech/sitemap.xml` | GSC → Sitemaps | |
| Verify `app.leontief.tech` as its own property | Google Search Console | |
| Verify `leontief.tech` | Bing Webmaster Tools | |
| Submit sitemap | Bing Webmaster Tools | |
| Spot-check one post in the Rich Results Test | search.google.com/test/rich-results | |
| Confirm `curl -s https://leontief.tech \| head -40` shows title/meta/OG | terminal | |

DNS-TXT verification is preferred over an HTML file: it survives redeploys and covers
every subdomain under one record.

## 5 · Honesty checklist (paste into every post PR)

- [ ] Testnet status disclosed anywhere the post explains how to do something.
- [ ] Every APY/APR figure is labelled illustrative and carries its date.
- [ ] No return promises, no "risk-free", no guaranteed anything.
- [ ] Zero mention of XLM yield or price (SCF Official Rules).
- [ ] "No token exists" stated wherever a reader could infer otherwise.
- [ ] Competitors named factually and generously, or not at all.
- [ ] Risks section present (mandatory for posts 2, 3, 5).
- [ ] Every figure checked against its linked primary source by the named author.
- [ ] Byline is a real person who edited and fact-checked the draft.
- [ ] Word count inside 1,200–1,800.

## 6 · Recurring

- **Quarterly figure refresh** (ops runbook): re-check every cited figure against its
  source, update the number *and* the `updatedDate`, and confirm the sitemap `lastmod`
  moved. Next due: 2026-11-02.
- After post 5 (`/blog/permissioned-liquidation`) is live, `permissioned liquidation`
  becomes a linked term wherever it appears in the docs and app copy, pointing at that
  one canonical definition URL.
