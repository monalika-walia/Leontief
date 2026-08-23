#!/usr/bin/env node
/**
 * The A9 gate. Runs against `dist/` after `astro build`, so every assertion is
 * made about the bytes a crawler and a reader actually receive — not about the
 * sources that produced them.
 *
 *   Phase 1  structural SEO: title, description, canonical, OG/Twitter, JSON-LD
 *   Phase 3  editorial: word count, one cluster, required internal links
 *   Phase 4  honesty rails: voice, APY labelling, XLM silence, risk sections
 *   Phase 6  acceptance: zero client JS, sitemap/RSS/robots, no orphan posts
 *
 * Exit code 1 with a grouped report on any failure. `--warn-only` downgrades
 * editorial findings so infrastructure PRs (which ship no posts) stay green.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/\/$/, "");
const ORIGIN = "https://leontief.tech";

/** Posts that must carry an explicit, headed risks section (A9 Phase 4). */
const RISKS_REQUIRED = new Set([
  "borrow-against-usdy-stellar",
  "etherfuse-cetes-rebase",
  "permissioned-liquidation",
]);

const BANNED = [
  "revolutionary",
  "game-changer",
  "game changer",
  "game-changing",
  "unlock the future",
  "paradigm shift",
  "risk-free",
  "riskless",
  "guaranteed return",
  "guaranteed yield",
  "no downside",
  "sure thing",
  "to the moon",
  "effortless",
  "supercharge",
];

/** XLM may be named; its price or yield may not be (SCF Official Rules). */
const XLM_FORBIDDEN_CONTEXT =
  /\b(price|priced|yield|yields|yielding|return|returns|apy|apr|appreciat\w*|worth|valuation|market cap|rally|pump|moon)\b/i;

const failures = [];
const notes = [];
const warnOnly = process.argv.includes("--warn-only");

const fail = (scope, message) => failures.push({ scope, message });
const note = (scope, message) => notes.push({ scope, message });
const editorial = (scope, message) => (warnOnly ? note(scope, message) : fail(scope, message));

// ── helpers ────────────────────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const read = (p) => readFileSync(p, "utf8");
const exists = (p) => {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
};

function head(html) {
  return html.slice(0, html.indexOf("</head>") + 7);
}

function metaContent(html, attr, value) {
  const re = new RegExp(
    `<meta[^>]*${attr}=["']${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "") : undefined;
}

function tagText(html, tag) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decode(m[1]) : undefined;
}

function attrOf(html, re) {
  return html.match(re)?.[1];
}

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Everything inside <div class="prose"> … </div>, tags stripped. */
function proseHtml(html) {
  const start = html.indexOf('<div class="prose">');
  if (start === -1) return "";
  // The prose block ends where the author card begins.
  const end = html.indexOf('<section class="author"', start);
  return html.slice(start, end === -1 ? html.length : end);
}

function textOf(html) {
  return decode(
    html
      .replace(/<(script|style|pre)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function ldBlocks(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]);
      out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch (err) {
      out.push({ __invalid: String(err) });
    }
  }
  return out;
}

const typeOf = (node) => (Array.isArray(node?.["@type"]) ? node["@type"][0] : node?.["@type"]);
const findLd = (blocks, type) => blocks.find((b) => typeOf(b) === type);

function hrefs(html) {
  return [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => decode(m[1]));
}

// ── collect the build ──────────────────────────────────────────────────────

if (!exists(DIST)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const files = walk(DIST).map((p) => relative(DIST, p).split(sep).join("/"));
const htmlFiles = files.filter((f) => f.endsWith(".html"));

const postFiles = htmlFiles.filter((f) => /^blog\/[^/]+\/index\.html$/.test(f));
const posts = postFiles.map((f) => {
  const slug = f.split("/")[1];
  const html = read(join(DIST, f));
  return { slug, file: f, html, path: `/blog/${slug}` };
});
const slugs = new Set(posts.map((p) => p.slug));

// ── Phase 1 · every page carries a real crawl surface ──────────────────────

const CRAWL_PAGES = [
  { file: "index.html", canonical: `${ORIGIN}/`, label: "landing" },
  { file: "landing.html", canonical: `${ORIGIN}/`, label: "landing mirror" },
  { file: "Litepaper.dc.html", canonical: `${ORIGIN}/litepaper`, label: "litepaper" },
  { file: "performance.html", canonical: `${ORIGIN}/performance`, label: "performance" },
  { file: "blog/index.html", canonical: `${ORIGIN}/blog`, label: "blog index" },
  ...posts.map((p) => ({ file: p.file, canonical: `${ORIGIN}${p.path}`, label: p.slug })),
];

for (const page of CRAWL_PAGES) {
  const scope = `meta:${page.label}`;
  const full = join(DIST, page.file);
  if (!exists(full)) {
    fail(scope, `${page.file} is missing from the build`);
    continue;
  }
  const h = head(read(full));

  // 75 matches the frontmatter cap. A SERP truncates nearer 60, so what actually
  // matters is that the cluster terms are front-loaded — this bound only stops a
  // headline from running away.
  const title = tagText(h, "title");
  if (!title) fail(scope, "no <title>");
  else if (title.length > 75) fail(scope, `<title> is ${title.length} chars (max 75)`);

  const desc = metaContent(h, "name", "description");
  if (!desc) fail(scope, "no meta description");
  else if (desc.length < 50 || desc.length > 165)
    fail(scope, `meta description is ${desc.length} chars (want 50–165)`);

  const canonical = attrOf(h, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  if (canonical !== page.canonical)
    fail(scope, `canonical is ${canonical ?? "absent"}, expected ${page.canonical}`);

  for (const [attr, prop] of [
    ["property", "og:type"],
    ["property", "og:title"],
    ["property", "og:description"],
    ["property", "og:url"],
    ["property", "og:image"],
    ["property", "og:image:alt"],
    ["name", "twitter:card"],
    ["name", "twitter:image"],
  ]) {
    if (!metaContent(h, attr, prop)) fail(scope, `missing ${prop}`);
  }

  const ogImage = metaContent(h, "property", "og:image");
  if (ogImage?.startsWith(ORIGIN)) {
    const rel = ogImage.slice(ORIGIN.length + 1);
    if (!exists(join(DIST, rel))) fail(scope, `og:image ${ogImage} was not generated`);
  }
}

// ── Phase 1.3 · JSON-LD, re-parsed from the built HTML ─────────────────────

for (const page of CRAWL_PAGES) {
  const full = join(DIST, page.file);
  if (!exists(full)) continue;
  const scope = `jsonld:${page.label}`;
  const blocks = ldBlocks(read(full));

  const broken = blocks.find((b) => b.__invalid);
  if (broken) fail(scope, `JSON-LD does not parse: ${broken.__invalid}`);

  // Landing mirror aside, Organization + WebSite are sitewide.
  if (!page.file.startsWith("Litepaper") && !page.file.startsWith("performance")) {
    if (!findLd(blocks, "Organization")) fail(scope, "no Organization node");
    if (!findLd(blocks, "WebSite")) fail(scope, "no WebSite node");
  }
}

for (const post of posts) {
  const scope = `jsonld:${post.slug}`;
  const blocks = ldBlocks(post.html);

  const art = findLd(blocks, "Article");
  if (!art) {
    fail(scope, "no Article node");
  } else {
    for (const key of [
      "headline",
      "description",
      "datePublished",
      "dateModified",
      "image",
      "author",
      "publisher",
      "wordCount",
    ]) {
      if (art[key] === undefined) fail(scope, `Article is missing ${key}`);
    }
    if (typeOf(art.author) !== "Person") fail(scope, "Article author is not a Person");
    else if (!art.author.name) fail(scope, "Article author has no name");
    for (const key of ["datePublished", "dateModified"]) {
      if (art[key] && Number.isNaN(Date.parse(art[key])))
        fail(scope, `Article ${key} is not a parseable date: ${art[key]}`);
    }
  }

  const crumbs = findLd(blocks, "BreadcrumbList");
  if (!crumbs) fail(scope, "no BreadcrumbList node");
  else if (!Array.isArray(crumbs.itemListElement) || crumbs.itemListElement.length < 2)
    fail(scope, "BreadcrumbList has fewer than 2 items");

  const faq = findLd(blocks, "FAQPage");
  if (faq) {
    const entries = Array.isArray(faq.mainEntity) ? faq.mainEntity : [];
    if (entries.length < 3) fail(scope, "FAQPage has fewer than 3 questions");
    for (const q of entries) {
      if (!q.name || !q.acceptedAnswer?.text)
        fail(scope, "FAQPage entry is missing a name or acceptedAnswer.text");
      // Google requires the answer to be visible on the page, not schema-only.
      const visible = textOf(proseHtml(post.html));
      const probe = String(q.acceptedAnswer?.text ?? "").slice(0, 40);
      if (probe && !visible.includes(probe))
        fail(scope, `FAQ answer is not visible in the prose: "${probe}…"`);
    }
  }
}

// ── Phase 6.1 · zero client JS on blog pages ───────────────────────────────

for (const page of [{ file: "blog/index.html", label: "blog index" }, ...posts.map((p) => ({ file: p.file, label: p.slug }))]) {
  const html = read(join(DIST, page.file));
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
  const runtime = scripts.filter((attrs) => !/type=["']application\/ld\+json["']/i.test(attrs));
  if (runtime.length > 0)
    fail(`js:${page.label}`, `${runtime.length} runtime <script> tag(s) — the blog ships zero JS`);
}

// ── Phase 3 & 4 · editorial rules, read off the rendered prose ─────────────

for (const post of posts) {
  const scope = `post:${post.slug}`;
  const prose = proseHtml(post.html);
  const text = textOf(prose);
  const art = findLd(ldBlocks(post.html), "Article") ?? {};

  const words = Number(art.wordCount ?? 0);
  if (words < 1200 || words > 1800)
    editorial(scope, `${words} words — the band is 1,200–1,800`);

  // One cluster per post: the kicker and the Article keywords must agree.
  const kicker = tagText(post.html, "p class=\"kicker\"");
  if (kicker && art.keywords && !String(art.keywords).startsWith(kicker))
    fail(scope, `kicker "${kicker}" is not the first Article keyword`);

  // Required internal links, counted inside the prose.
  const links = hrefs(prose);
  if (!links.some((h) => h.startsWith("https://app.leontief.tech")))
    editorial(scope, "no link to the app in the body");
  if (!links.some((h) => h.startsWith("https://docs.leontief.tech")))
    editorial(scope, "no link to a docs page in the body");

  const siblingLinks = new Set(
    links
      .map((h) => h.match(/^\/blog\/([a-z0-9-]+)$/)?.[1])
      .filter((s) => s && s !== post.slug && slugs.has(s)),
  );
  const wanted = Math.min(2, slugs.size - 1);
  if (siblingLinks.size < wanted)
    editorial(
      scope,
      `${siblingLinks.size} sibling post link(s) in the body, want ${wanted}`,
    );

  // Voice.
  if (text.includes("!")) fail(scope, "exclamation mark in the prose");
  for (const phrase of BANNED) {
    if (new RegExp(`\\b${phrase.replace(/[-\s]/g, "[-\\s]")}\\b`, "i").test(text))
      fail(scope, `banned hype phrase: "${phrase}"`);
  }

  // Every APY/APR figure is illustrative and dated, in its own sentence.
  for (const sentence of text.split(/(?<=[.?])\s+/)) {
    if (!/\d[\d.,]*\s*%/.test(sentence)) continue;
    if (!/\b(apy|apr|yield)\b/i.test(sentence)) continue;
    if (!/illustrative/i.test(sentence) || !/\b(19|20)\d{2}\b/.test(sentence))
      fail(
        scope,
        `a yield figure is not labelled illustrative and dated: "${sentence.slice(0, 110)}…"`,
      );
  }

  // XLM price and yield are never mentioned.
  for (const sentence of text.split(/(?<=[.?])\s+/)) {
    if (/\bXLM\b/.test(sentence) && XLM_FORBIDDEN_CONTEXT.test(sentence))
      fail(scope, `XLM price/yield reference: "${sentence.slice(0, 110)}…"`);
  }

  // Any how-to discloses testnet status.
  if (/\b(how to|step[- ]by[- ]step|walkthrough|try it)\b/i.test(text) && !/testnet/i.test(text))
    fail(scope, "reads as a how-to but never says testnet");

  // Risks sections where the slate requires them.
  if (RISKS_REQUIRED.has(post.slug)) {
    const headings = [...prose.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => textOf(m[1]));
    if (!headings.some((h) => /risk/i.test(h)))
      fail(scope, "no <h2> risks section (mandatory for this post)");
  }
}

// ── Phase 6.4 · internal links resolve, no orphan posts ────────────────────

const REWRITES = new Set(["/litepaper", "/performance"]);

function resolves(href) {
  if (REWRITES.has(href)) return true;
  if (href === "/" || href === "") return exists(join(DIST, "index.html"));
  const clean = href.split("#")[0].split("?")[0];
  if (clean === "") return true;
  const rel = clean.replace(/^\//, "");
  return exists(join(DIST, rel)) || exists(join(DIST, rel, "index.html"));
}

for (const page of [{ file: "blog/index.html", label: "blog index" }, ...posts.map((p) => ({ file: p.file, label: p.slug }))]) {
  const html = read(join(DIST, page.file));
  for (const href of new Set(hrefs(html))) {
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    if (!resolves(href)) fail(`links:${page.label}`, `internal link 404s in the build: ${href}`);
  }
}

if (posts.length > 1) {
  const indexHtml = read(join(DIST, "blog/index.html"));
  const linkedFromIndex = new Set(
    hrefs(indexHtml)
      .map((h) => h.match(/^\/blog\/([a-z0-9-]+)$/)?.[1])
      .filter(Boolean),
  );
  const inbound = new Map([...slugs].map((s) => [s, 0]));
  for (const post of posts) {
    for (const s of new Set(
      hrefs(post.html)
        .map((h) => h.match(/^\/blog\/([a-z0-9-]+)$/)?.[1])
        .filter((s) => s && s !== post.slug),
    )) {
      inbound.set(s, (inbound.get(s) ?? 0) + 1);
    }
  }
  for (const slug of slugs) {
    if (!linkedFromIndex.has(slug)) fail("links:index", `${slug} is not listed on /blog`);
    if ((inbound.get(slug) ?? 0) === 0) fail("links:orphan", `${slug} has no inbound post link`);
  }
}

// ── Phase 1.2 / 1.7 · sitemap, RSS, robots ─────────────────────────────────

const sitemapPath = join(DIST, "sitemap.xml");
if (!exists(sitemapPath)) {
  fail("sitemap", "sitemap.xml was not generated");
} else {
  const xml = read(sitemapPath);
  if (!xml.includes("<urlset")) fail("sitemap", "no <urlset> root");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const offHost = locs.filter((l) => !l.startsWith(ORIGIN));
  if (offHost.length)
    fail("sitemap", `off-host URLs are not permitted: ${offHost.join(", ")}`);
  for (const post of posts) {
    const loc = `${ORIGIN}${post.path}`;
    if (!locs.includes(loc)) fail("sitemap", `${post.path} is missing`);
  }
  // lastmod must track updatedDate — the Article's dateModified is the same value.
  for (const post of posts) {
    const art = findLd(ldBlocks(post.html), "Article");
    if (!art?.dateModified) continue;
    const want = String(art.dateModified).slice(0, 10);
    const block = xml.match(
      new RegExp(`<loc>${ORIGIN}${post.path}</loc>\\s*<lastmod>([^<]+)</lastmod>`),
    );
    if (!block) fail("sitemap", `${post.path} has no <lastmod>`);
    else if (block[1] !== want)
      fail("sitemap", `${post.path} lastmod ${block[1]} ≠ dateModified ${want}`);
  }
}

const rssPath = join(DIST, "blog/rss.xml");
if (!exists(rssPath)) {
  fail("rss", "blog/rss.xml was not generated");
} else {
  const xml = read(rssPath);
  if (!xml.includes("<rss")) fail("rss", "no <rss> root");
  for (const post of posts) {
    if (!xml.includes(`${ORIGIN}${post.path}`)) fail("rss", `${post.path} is missing from the feed`);
  }
}

const robotsPath = join(DIST, "robots.txt");
if (!exists(robotsPath)) {
  fail("robots", "robots.txt was not generated");
} else {
  const txt = read(robotsPath);
  if (!/^Sitemap:\s*https:\/\/leontief\.tech\/sitemap\.xml$/m.test(txt))
    fail("robots", "does not point at https://leontief.tech/sitemap.xml");
  if (/^Disallow:\s*\/\s*$/m.test(txt)) fail("robots", "disallows the whole site");
}

// ── report ─────────────────────────────────────────────────────────────────

const group = (rows) => {
  const by = new Map();
  for (const r of rows) by.set(r.scope, [...(by.get(r.scope) ?? []), r.message]);
  return by;
};

if (notes.length) {
  console.log(`\n  ${notes.length} editorial note(s) (--warn-only):`);
  for (const [scope, msgs] of group(notes)) {
    console.log(`\n  ${scope}`);
    for (const m of msgs) console.log(`    · ${m}`);
  }
}

if (failures.length) {
  console.error(`\n  ${failures.length} SEO/editorial failure(s):`);
  for (const [scope, msgs] of group(failures)) {
    console.error(`\n  ${scope}`);
    for (const m of msgs) console.error(`    ✗ ${m}`);
  }
  console.error("");
  process.exit(1);
}

console.log(
  `\n  seo-check: ${CRAWL_PAGES.length} page(s), ${posts.length} post(s) — all checks pass.\n`,
);
