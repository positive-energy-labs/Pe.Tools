export { docsSources, type DocsHit, type DocsSource } from "./types.ts";
export { searchHelp, fetchHelpTopic, type HelpSection } from "./help.ts";
export { searchBlog, fetchBlogPost } from "./blog.ts";
export { searchTbc, fetchTbcPost } from "./tbc.ts";
export { searchAu, fetchAuClass } from "./au.ts";

/** One source's outcome: its hits, or the reason it failed. A failure never sinks the other sources. */
export type SourceResult<Hit> = { source: string; hits: Hit[] } | { source: string; error: string };

export async function runSources<Hit>(
  runners: Record<string, () => Promise<Hit[]>>,
): Promise<SourceResult<Hit>[]> {
  return Promise.all(
    Object.entries(runners).map(async ([source, run]): Promise<SourceResult<Hit>> => {
      try {
        return { source, hits: await run() };
      } catch (error) {
        return { source, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

export const supportedFetchHosts = [
  "local:<memberId> (API index)",
  "rvtdocs.com",
  "help.autodesk.com",
  "blog.autodesk.io",
  "jeremytammik.github.io (The Building Coder)",
  "www.autodesk.com/autodesk-university/class/<slug>",
] as const;

export type DocsPageKind = "local" | "rvtdocs" | "help" | "blog" | "tbc" | "au";

/** Picks the fetcher for a search-result url by host; a bare slug is an rvtdocs path. */
export function classifyDocsUrl(url: string): DocsPageKind {
  if (url.startsWith("local:")) return "local";
  if (!/^https?:\/\//i.test(url)) return "rvtdocs";
  const { hostname, pathname } = new URL(url);
  if (hostname === "rvtdocs.com") return "rvtdocs";
  if (hostname === "help.autodesk.com") return "help";
  if (hostname === "blog.autodesk.io") return "blog";
  if (hostname === "jeremytammik.github.io" && pathname.startsWith("/tbc/")) return "tbc";
  if (hostname === "www.autodesk.com" && pathname.startsWith("/autodesk-university/class/"))
    return "au";
  throw new Error(`Unsupported docs URL: ${url}. Supported: ${supportedFetchHosts.join("; ")}.`);
}
