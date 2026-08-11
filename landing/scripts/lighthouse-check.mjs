#!/usr/bin/env node
/**
 * A9 Phase 6.1 — Lighthouse on the blog index and up to three sample post pages:
 * SEO 100, Performance ≥ 95, CLS < 0.02, LCP < 1.5 s, and zero client JS shipped.
 *
 * Runs against `astro preview` over the real `dist/` output. Lighthouse and Chrome
 * are only needed here, so they are installed on demand in CI rather than carried
 * as project dependencies (Chrome is preinstalled on GitHub's ubuntu runners).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, ".lighthouse");
const PORT = 4321;
const BASE = `http://localhost:${PORT}`;

const BUDGET = {
  seo: 1.0,
  performance: 0.95,
  "cumulative-layout-shift": 0.02,
  "largest-contentful-paint": 1500,
};

if (!existsSync(DIST)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const postSlugs = existsSync(join(DIST, "blog"))
  ? readdirSync(join(DIST, "blog"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  : [];

const targets = ["/blog", ...postSlugs.slice(0, 3).map((s) => `/blog/${s}`)];
console.log(`Auditing ${targets.length} page(s): ${targets.join(", ")}`);

const preview = spawn("npx", ["astro", "preview", "--port", String(PORT)], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "inherit"],
});
preview.stdout.on("data", (b) => process.stdout.write(`[preview] ${b}`));

const stop = () => {
  if (!preview.killed) preview.kill("SIGTERM");
};
process.on("exit", stop);
process.on("SIGINT", () => (stop(), process.exit(130)));

await waitFor(`${BASE}/blog`, 30_000);

const failures = [];

for (const path of targets) {
  const slug = path.replace(/\//g, "_") || "_root";
  const report = join(OUT, `${slug}.json`);

  await run("npx", [
    "--yes",
    "lighthouse@12",
    `${BASE}${path}`,
    "--quiet",
    "--only-categories=performance,seo,accessibility,best-practices",
    // Default (mobile) config: Moto G Power on simulated slow 4G — the network
    // the "LCP < 1.5 s on 4G" budget is written against.
    "--throttling-method=simulate",
    "--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage",
    "--output=json",
    `--output-path=${report}`,
  ]);

  const lhr = JSON.parse(await readJson(report));
  const seo = lhr.categories.seo.score;
  const perf = lhr.categories.performance.score;
  const cls = lhr.audits["cumulative-layout-shift"].numericValue;
  const lcp = lhr.audits["largest-contentful-paint"].numericValue;
  const bootup = lhr.audits["bootup-time"]?.numericValue ?? 0;

  console.log(
    `\n${path}\n  SEO ${pct(seo)}  Perf ${pct(perf)}  CLS ${cls.toFixed(4)}  LCP ${Math.round(lcp)} ms`,
  );

  if (seo < BUDGET.seo) failures.push(`${path}: SEO ${pct(seo)} — must be 100`);
  if (perf < BUDGET.performance)
    failures.push(`${path}: Performance ${pct(perf)} — must be ≥ 95`);
  if (cls >= BUDGET["cumulative-layout-shift"])
    failures.push(`${path}: CLS ${cls.toFixed(4)} — must be < 0.02`);
  if (lcp >= BUDGET["largest-contentful-paint"])
    failures.push(`${path}: LCP ${Math.round(lcp)} ms — must be < 1500 ms`);
  if (bootup > 0) failures.push(`${path}: ${bootup} ms of script evaluation — expected zero JS`);
}

stop();

if (failures.length) {
  console.error(`\n  ${failures.length} budget failure(s):`);
  for (const f of failures) console.error(`    ✗ ${f}`);
  console.error("");
  process.exit(1);
}
console.log("\n  lighthouse-check: every page is within budget.\n");

// ── helpers ────────────────────────────────────────────────────────────────

function pct(score) {
  return `${Math.round((score ?? 0) * 100)}`;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function readJson(path) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* server not up yet */
    }
    if (Date.now() > deadline) {
      stop();
      throw new Error(`preview server did not answer ${url} within ${timeoutMs} ms`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}
