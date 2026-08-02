import type { APIRoute } from "astro";
import { SITE, url } from "../data/site";
import { postPath, publishedPosts } from "../lib/post";

/**
 * One sitemap, one host. Only leontief.tech URLs appear here — a sitemap may not
 * list URLs on another host without cross-submission, so docs.leontief.tech ships
 * its own (Docusaurus generates it) and is submitted to Search Console as its own
 * property. See docs/SEO.md.
 *
 * `lastmod` for a post is its `updatedDate` when present, otherwise `pubDate`:
 * editing a post and bumping `updatedDate` moves the sitemap (A9 Phase 6.5).
 */
type Entry = { loc: string; lastmod?: string; changefreq: string; priority: string };

export const GET: APIRoute = async () => {
  const posts = await publishedPosts();
  const newest = posts[0];

  const entries: Entry[] = [
    { loc: url("/"), changefreq: "weekly", priority: "1.0" },
    {
      loc: url("/blog"),
      lastmod: day(newest?.data.updatedDate ?? newest?.data.pubDate),
      changefreq: "weekly",
      priority: "0.9",
    },
    { loc: SITE.litepaper, changefreq: "monthly", priority: "0.8" },
    { loc: SITE.performance, changefreq: "daily", priority: "0.6" },
    ...posts.map((post) => ({
      loc: url(postPath(post.data.slug)),
      lastmod: day(post.data.updatedDate ?? post.data.pubDate),
      changefreq: "monthly",
      priority: "0.8",
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(render).join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};

function render(e: Entry): string {
  return [
    "  <url>",
    `    <loc>${e.loc}</loc>`,
    ...(e.lastmod ? [`    <lastmod>${e.lastmod}</lastmod>`] : []),
    `    <changefreq>${e.changefreq}</changefreq>`,
    `    <priority>${e.priority}</priority>`,
    "  </url>",
  ].join("\n");
}

function day(d?: Date): string | undefined {
  return d ? d.toISOString().slice(0, 10) : undefined;
}
