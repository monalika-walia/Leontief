import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { authorIds } from "./data/authors";

/**
 * A9 Phase 0 frontmatter schema (binding):
 *   title, description, slug, pubDate, updatedDate, author, tags[], cluster, draft
 *
 * `cluster` is the single target keyword cluster the post is written for — one
 * per post, enforced here as a required scalar so a post cannot quietly chase two.
 * `faq` opts a post into FAQPage JSON-LD (A9 Phase 1.3) and requires the Q/A pairs
 * to be declared in frontmatter so the structured data and the prose cannot drift.
 */
const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.md" }),
  schema: z
    .object({
      title: z.string().min(10).max(75),
      description: z.string().min(50).max(165),
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase, hyphenated, no dates"),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      author: z.enum(authorIds as [string, ...string[]]),
      tags: z.array(z.string()).min(1),
      cluster: z.string().min(3),
      draft: z.boolean().default(false),
      /** The "In one line" ledger-entry summary box at the top of every post. */
      oneLine: z.string().min(20).max(240),
      /** Optional FAQPage schema — posts 2 and 3 in the editorial slate. */
      faq: z
        .array(z.object({ q: z.string().min(8), a: z.string().min(20) }))
        .min(3)
        .optional(),
      /** Sibling posts this one links to; the orphan checker reads these. */
      siblings: z.array(z.string()).default([]),
    })
    .strict(),
});

export const collections = { blog };
