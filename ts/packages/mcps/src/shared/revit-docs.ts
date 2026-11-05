import { extractRvtDocsText } from "./rvt-api/extractDocs.js";
import { fetchLocalDoc } from "./rvt-api/local-docs.ts";
import { searchWrapper } from "./rvt-api/searchDocs.ts";
import { toolInputArgSchemas, revitApiQueryInputSchema } from "../shared/rvt-api/validators.ts";
import { createTool } from "./tool.ts";
import z from "zod";

export const revitApiSearch = createTool({
  id: "revit_api_docs_search",
  description:
    "Search Revit API documentation for API entities, signatures, members, and remarks. Prefers the BM25 index built from the local Revit install (results carry summary/remarks/since inline plus local source files using the member); falls back to web search. Set extractFirstResult to include full doc text on the first result only. Use live host operations or scripts for current model/session/document state.",
  inputSchema: revitApiQueryInputSchema,
  execute: async (input) => {
    const { queryString, queryTypes, year, maxResults, extractFirstResult } = input;
    const results = await searchWrapper(queryString, year, maxResults, queryTypes);
    if (!extractFirstResult || results.length === 0) return results;

    const [firstResult, ...remainingResults] = results;
    const extractedText = await fetchDocText(firstResult.url, year);
    return [{ ...firstResult, extractedText }, ...remainingResults];
  },
});

export const revitApiFetch = createTool({
  id: "revit_api_docs_fetch",
  description:
    "Fetch one Revit API documentation page by slug returned from revit_api_docs_search — either local:<memberId> (local install index) or an rvtdocs URL slug. Use it for signatures/members/remarks after narrowing to a specific API entity, not for live document facts.",
  inputSchema: z.object({
    urlSlug: toolInputArgSchemas.urlSlug,
    year: toolInputArgSchemas.year,
  }),
  execute: async (input) => fetchDocText(input.urlSlug, input.year),
});

async function fetchDocText(urlSlug: string, year: number): Promise<string> {
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
