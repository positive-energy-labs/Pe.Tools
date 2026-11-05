import { htmlToText, plainText } from "./text.ts";
import type { DocsHit } from "./types.ts";
import { z } from "zod";

const apiBase = "https://blog.autodesk.io/wp-json/wp/v2/posts";
const revitCategoryId = 190615;

const rendered = z.object({ rendered: z.string() });
const postSearchSchema = z.array(
  z.object({ date: z.string(), link: z.string(), title: rendered, excerpt: rendered }),
);
const postBodySchema = z.array(
  z.object({ date: z.string(), link: z.string(), title: rendered, content: rendered }),
);

export function parseBlogSearch(json: unknown): DocsHit[] {
  return postSearchSchema.parse(json).map((post) => ({
    source: "blog",
    title: plainText(post.title.rendered),
    url: post.link,
    date: post.date.slice(0, 10),
    snippet: plainText(post.excerpt.rendered),
  }));
}

export async function searchBlog(input: {
  query: string;
  revitOnly: boolean;
  max: number;
}): Promise<DocsHit[]> {
  const params = new URLSearchParams({
    search: input.query,
    orderby: "relevance",
    per_page: String(input.max),
    _fields: "id,date,link,title,excerpt",
  });
  if (input.revitOnly) params.set("categories", String(revitCategoryId));
  const response = await fetch(`${apiBase}?${params}`);
  if (!response.ok) throw new Error(`Blog search failed: HTTP ${response.status}`);
  return parseBlogSearch(await response.json());
}

/** Post body as text with code kept fenced. */
export function parseBlogPost(json: unknown): string {
  const [post] = postBodySchema.parse(json);
  if (!post) throw new Error("Blog post not found for that URL slug.");
  return `# ${plainText(post.title.rendered)}\n${post.link} (${post.date.slice(0, 10)})\n\n${htmlToText(post.content.rendered)}`;
}

/** The post is resolved from the URL's last path segment. */
export async function fetchBlogPost(url: string): Promise<string> {
  const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1);
  if (!slug) throw new Error(`Blog URL has no post slug: ${url}`);
  const params = new URLSearchParams({ slug, _fields: "date,link,title,content" });
  const response = await fetch(`${apiBase}?${params}`);
  if (!response.ok) throw new Error(`Blog post fetch failed: HTTP ${response.status} for ${url}`);
  return parseBlogPost(await response.json());
}
