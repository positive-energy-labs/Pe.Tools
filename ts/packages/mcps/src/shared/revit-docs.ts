import {
  classifyDocsUrl,
  docsSources,
  fetchAuClass,
  fetchBlogPost,
  fetchHelpTopic,
  fetchTbcPost,
  runSources,
  searchAu,
  searchBlog,
  searchHelp,
  searchTbc,
} from "./autodesk-docs/index.ts";
import { extractRvtDocsText } from "./rvt-api/extractDocs.js";
import { fetchLocalDoc } from "./rvt-api/local-docs.ts";
import { searchWrapper } from "./rvt-api/searchDocs.ts";
import { SearchResultTypes, toolInputArgSchemas } from "./rvt-api/validators.ts";
import { createTool } from "./tool.ts";
import z from "zod";

const defaultMaxResults = 5;

const searchInput = z.object({
  query: toolInputArgSchemas.queryString,
  sources: z
    .array(z.enum(docsSources))
    .min(1)
    .optional()
    .describe("Sources to search, in parallel. Default: all five."),
  maxResults: z
    .number()
    .min(1)
    .max(25)
    .default(defaultMaxResults)
    .describe("Maximum hits per source."),
  api: z
    .object({
      queryTypes: toolInputArgSchemas.queryTypes,
      year: toolInputArgSchemas.year,
      extractFirstResult: toolInputArgSchemas.extractFirstResult,
    })
    .optional()
    .describe("Filters for the api source (types, API doc year, inline text of the first hit)."),
  help: z
    .object({
      section: z
        .enum(["dev", "user", "all"])
        .default("all")
        .describe("dev = API developer guide and reference; user = product user guide."),
      year: z.number().optional().describe("Release year. Default: newest published."),
    })
    .optional(),
  blog: z
    .object({
      revitOnly: z.boolean().default(true).describe("Restrict to the Revit category."),
    })
    .optional(),
  au: z.object({ year: z.number().optional().describe("Autodesk University year.") }).optional(),
});

export const revitDocsSearch = createTool({
  id: "revit_docs_search",
  description: [
    "Search Autodesk's Revit knowledge in parallel. Each source answers separately; a failing source reports its own error and never hides the rest.",
    "Sources: api = API class/member signatures and remarks (local Revit install index first, then rvtdocs); help = help.autodesk.com for the newest Revit year, both the product user guide and the API developer guide, the place to check whether Revit can do something now; blog = blog.autodesk.io Revit developer posts with worked API code and workarounds; tbc = The Building Coder archive (Jeremy Tammik), title search, long-running API how-tos; au = Autodesk University classes, with handout/slides attachments.",
    "Hits are { source, title, url, date?, snippet? } (api hits add signature fields); pass a url to revit_docs_fetch to read it.",
    'Before telling a user "Revit cannot do X", cite a help, blog, or tbc hit that shows it; use sources ["help","blog"] to check. Use live host operations or scripts for current model/session/document state.',
  ].join("\n"),
  inputSchema: searchInput,
  execute: async (input) => {
    const wanted = input.sources ?? docsSources;
    const max = input.maxResults;
    const runners: Record<string, () => Promise<object[]>> = {
      api: async () => {
        const options = input.api ?? {
          queryTypes: [...SearchResultTypes],
          year: toolInputArgSchemas.year.parse(undefined),
          extractFirstResult: false,
        };
        const results = await searchWrapper(input.query, options.year, max, options.queryTypes);
        const hits: object[] = results.map((r) => ({ source: "api", ...r }));
        const first = results[0];
        if (!options.extractFirstResult || !first) return hits;
        const extractedText = await fetchApiPage(first.url, options.year);
        return [{ source: "api", ...first, extractedText }, ...hits.slice(1)];
      },
      help: () =>
        searchHelp({
          query: input.query,
          section: input.help?.section ?? "all",
          year: input.help?.year,
          max,
        }),
      blog: () => searchBlog({ query: input.query, revitOnly: input.blog?.revitOnly ?? true, max }),
      tbc: () => searchTbc({ query: input.query, max }),
      au: () => searchAu({ query: input.query, year: input.au?.year, max }),
    };
    return runSources(Object.fromEntries(wanted.map((source) => [source, runners[source]!])));
  },
});

export const revitDocsFetch = createTool({
  id: "revit_docs_fetch",
  description:
    "Read one page returned by revit_docs_search as clean text: api (local:<memberId> or an rvtdocs url/slug), help.autodesk.com topics, blog.autodesk.io posts (code kept fenced), The Building Coder posts (jeremytammik.github.io/tbc), or an Autodesk University class url (abstract, handout/slides attachment urls, video id). Other hosts are refused. Not for live document facts.",
  inputSchema: z.object({
    url: z.string().describe("A url or slug exactly as revit_docs_search returned it."),
    year: toolInputArgSchemas.year.describe(
      "API doc year; only used for api (local:/rvtdocs) pages.",
    ),
  }),
  execute: async ({ url, year }) => {
    switch (classifyDocsUrl(url)) {
      case "local":
      case "rvtdocs":
        return fetchApiPage(url, year);
      case "help":
        return fetchHelpTopic(url);
      case "blog":
        return fetchBlogPost(url);
      case "tbc":
        return fetchTbcPost(url);
      case "au":
        return fetchAuClass(url);
    }
  },
});

async function fetchApiPage(urlSlug: string, year: number): Promise<string> {
  if (urlSlug.startsWith("local:")) {
    const doc = fetchLocalDoc(urlSlug.slice("local:".length), year);
    if (doc) return doc;
    throw new Error(`Member not found in the local Revit ${year} docs index: ${urlSlug}`);
  }
  return extractRvtDocsText(rvtDocsUrlFromSlug(urlSlug));
}

function rvtDocsUrlFromSlug(urlSlug: string): string {
  if (/^https?:\/\//i.test(urlSlug)) return urlSlug;

  return urlSlug.startsWith("/")
    ? `https://rvtdocs.com${urlSlug}`
    : `https://rvtdocs.com/${urlSlug}`;
}
