import type { CollectionEntry } from "astro:content";
import { getCollection } from "astro:content";

export type Post = CollectionEntry<"blog">;

/** Drafts never reach the build, the sitemap, or the feed. */
export async function publishedPosts(): Promise<Post[]> {
  const posts = await getCollection("blog", ({ data }) => data.draft !== true);
  return posts.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

export const postPath = (slug: string) => `/blog/${slug}`;
export const ogPath = (slug: string) => `/og/${slug}.png`;

/**
 * Word count over the rendered prose, not the raw source: frontmatter, fenced
 * code, link targets, and markdown punctuation are not words a reader reads.
 * The 1,200–1,800 band in A9 Phase 3 is checked against this number.
 */
export function wordCount(body: string): number {
  const prose = body
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\|.*\|$/gm, " ")
    .replace(/[#>*_~|-]/g, " ");
  const words = prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,%$-]*/gu);
  return words ? words.length : 0;
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export const formatDate = (d: Date) => DATE.format(d);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
