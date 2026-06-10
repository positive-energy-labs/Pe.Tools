import { extractRvtDocsText } from "./rvt-api/extractDocs.js";
import { searchWrapper } from "./rvt-api/searchDocs.ts";
import {
  defaultRevitApiDocsYear,
  defaultRevitApiMaxResults,
  toolInputArgSchemas,
  toolOutputSchemas,
  revitApiQueryInputSchema,
} from "../shared/rvt-api/validators.ts";
import { createTool } from "@mastra/core/tools";
import z from "zod";

export const revitApiSearch = createTool({
  id: "revit_api_docs_search",
  description:
    "Search Revit API documentation for exact API entities, signatures, members, and remarks. Set extractFirstResult to include extractedText on the first result only. Use live host operations or scripts for current model/session/document state.",
  inputSchema: revitApiQueryInputSchema,
  outputSchema: toolOutputSchemas.searchResultsSchema,
  execute: async (input) => {
    const {
      queryString,
      queryTypes,
      year = defaultRevitApiDocsYear,
      maxResults = defaultRevitApiMaxResults,
      extractFirstResult = false,
    } = input;
    const results = await searchWrapper(queryString, year, maxResults, queryTypes);
    if (!extractFirstResult || results.length === 0) return results;

    const [firstResult, ...remainingResults] = results;
    const extractedText = await extractRvtDocsText(rvtDocsUrlFromSlug(firstResult.url));
    return [{ ...firstResult, extractedText }, ...remainingResults];
  },
});

export const revitApiFetch = createTool({
  id: "revit_api_docs_fetch",
  description:
    "Fetch one Revit API documentation page by rvtdocs URL slug returned from revit_api_search. Use it for signatures/members/remarks after narrowing to a specific API entity, not for live document facts.",
  inputSchema: z.object({
    urlSlug: toolInputArgSchemas.urlSlug,
  }),
  outputSchema: toolOutputSchemas.docsTextSchema,
  execute: async (input) => extractRvtDocsText(rvtDocsUrlFromSlug(input.urlSlug)),
});

function rvtDocsUrlFromSlug(urlSlug: string): string {
  if (/^https?:\/\//i.test(urlSlug)) return urlSlug;

  return urlSlug.startsWith("/")
    ? `https://rvtdocs.com${urlSlug}`
    : `https://rvtdocs.com/${urlSlug}`;
}
