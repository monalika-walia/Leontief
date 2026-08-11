import type { APIRoute, GetStaticPaths } from "astro";
import { SITE } from "../../data/site";
import { type OgCard, renderOgPng } from "../../lib/og";
import { publishedPosts } from "../../lib/post";

export const getStaticPaths = (async () => {
  const posts = await publishedPosts();

  return [
    {
      params: { slug: "home" },
      props: {
        card: {
          kicker: "Leontief",
          title: "Put tokenized treasuries to work on Stellar",
        } satisfies OgCard,
      },
    },
    {
      params: { slug: "blog" },
      props: { card: { kicker: "Leontief · Notes", title: SITE.blogTitle } satisfies OgCard },
    },
    {
      params: { slug: "litepaper" },
      props: {
        card: {
          kicker: "Litepaper v1.0",
          title: "The adapter layer for real-world assets on Stellar",
        } satisfies OgCard,
      },
    },
    {
      params: { slug: "app" },
      props: {
        card: {
          kicker: "The app",
          title: "Wrap & borrow on Stellar testnet",
        } satisfies OgCard,
      },
    },
    {
      params: { slug: "performance" },
      props: {
        card: {
          kicker: "Live testnet",
          title: "Wrapped AUM, utility ratio, and open positions",
          footnote: "Stellar · testnet · live",
        } satisfies OgCard,
      },
    },
    ...posts.map((post) => ({
      params: { slug: post.data.slug },
      props: {
        card: { kicker: post.data.cluster, title: post.data.title } satisfies OgCard,
      },
    })),
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgPng((props as { card: OgCard }).card);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
