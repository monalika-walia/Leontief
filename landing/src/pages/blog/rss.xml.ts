import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { AUTHORS, type AuthorId } from "../../data/authors";
import { SITE, url } from "../../data/site";
import { postPath, publishedPosts } from "../../lib/post";

export const GET: APIRoute = async () => {
  const posts = await publishedPosts();
  const newest = posts[0] ? (posts[0].data.updatedDate ?? posts[0].data.pubDate) : undefined;

  return rss({
    title: SITE.blogTitle,
    description: SITE.blogDescription,
    site: SITE.origin,
    trailingSlash: false,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      link: url(postPath(post.data.slug)),
      pubDate: post.data.pubDate,
      author: AUTHORS[post.data.author as AuthorId].name,
      categories: [post.data.cluster, ...post.data.tags],
    })),
    customData: [
      "<language>en</language>",
      ...(newest ? [`<lastBuildDate>${newest.toUTCString()}</lastBuildDate>`] : []),
      `<copyright>Leontief — ${SITE.publisher}</copyright>`,
    ].join(""),
  });
};
