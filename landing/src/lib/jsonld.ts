/**
 * JSON-LD builders, typed against schema-dts (A9 Phase 1.3).
 *
 * The types do the validation: `astro check` / `tsc` fails the build if a graph
 * node uses a property schema.org does not define on that type, or gives it a
 * value of the wrong shape. `scripts/seo-check.mjs` then re-parses the *built*
 * HTML and asserts the required fields survived rendering.
 */
import type {
  Article,
  BreadcrumbList,
  FAQPage,
  Organization,
  Person,
  WebSite,
  WithContext,
} from "schema-dts";
import { AUTHORS, type AuthorId } from "../data/authors";
import { SITE, url } from "../data/site";

const CONTEXT = "https://schema.org" as const;

export const organization = (): WithContext<Organization> => ({
  "@context": CONTEXT,
  "@type": "Organization",
  "@id": `${SITE.origin}/#organization`,
  name: SITE.name,
  url: SITE.origin,
  description: SITE.description,
  sameAs: [SITE.github, SITE.docs],
});

export const website = (): WithContext<WebSite> => ({
  "@context": CONTEXT,
  "@type": "WebSite",
  "@id": `${SITE.origin}/#website`,
  name: SITE.name,
  url: SITE.origin,
  description: SITE.description,
  inLanguage: "en",
  publisher: { "@id": `${SITE.origin}/#organization` },
});

export const person = (id: AuthorId): Person => {
  const a = AUTHORS[id];
  return {
    "@type": "Person",
    "@id": `${SITE.origin}/#person-${a.id}`,
    name: a.name,
    jobTitle: a.role,
    description: a.bio,
    ...(a.url ? { url: a.url, sameAs: [a.url] } : {}),
    worksFor: { "@id": `${SITE.origin}/#organization` },
  };
};

export type ArticleInput = {
  headline: string;
  description: string;
  path: string;
  author: AuthorId;
  datePublished: Date;
  dateModified?: Date;
  image: string;
  keywords: string[];
  wordCount: number;
};

export const article = (a: ArticleInput): WithContext<Article> => ({
  "@context": CONTEXT,
  "@type": "Article",
  "@id": `${url(a.path)}#article`,
  headline: a.headline,
  description: a.description,
  url: url(a.path),
  mainEntityOfPage: { "@type": "WebPage", "@id": url(a.path) },
  author: person(a.author),
  publisher: { "@id": `${SITE.origin}/#organization` },
  datePublished: iso(a.datePublished),
  dateModified: iso(a.dateModified ?? a.datePublished),
  image: a.image,
  keywords: a.keywords.join(", "),
  wordCount: a.wordCount,
  inLanguage: "en",
  isAccessibleForFree: true,
});

export const faqPage = (
  path: string,
  faq: readonly { q: string; a: string }[],
): WithContext<FAQPage> => ({
  "@context": CONTEXT,
  "@type": "FAQPage",
  "@id": `${url(path)}#faq`,
  mainEntity: faq.map((entry) => ({
    "@type": "Question" as const,
    name: entry.q,
    acceptedAnswer: { "@type": "Answer" as const, text: entry.a },
  })),
});

export const breadcrumbs = (
  trail: readonly { name: string; path: string }[],
): WithContext<BreadcrumbList> => ({
  "@context": CONTEXT,
  "@type": "BreadcrumbList",
  itemListElement: trail.map((crumb, i) => ({
    "@type": "ListItem" as const,
    position: i + 1,
    name: crumb.name,
    item: url(crumb.path),
  })),
});

/** schema.org Date/DateTime wants ISO 8601; dates are authored as plain days. */
function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
