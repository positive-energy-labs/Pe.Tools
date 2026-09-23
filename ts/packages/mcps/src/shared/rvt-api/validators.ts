import z from "zod";

export type SearchResult = z.infer<typeof toolOutputSchemas.searchResultSchema>;

export const SearchResultTypes = [
  "Class",
  "Constructor",
  "Method",
  "Methods",
  "Property",
  "Properties",
  "Interface",
  "Enumeration",
] as const;

const defaultRevitApiDocsYear = 2025;
const defaultRevitApiMaxResults = 10;

const usageExampleSchema = z.object({
  file: z.string().describe("Absolute path to a local source file using this API member."),
  startLine: z.number(),
  endLine: z.number(),
  enclosing: z.string().describe("Fully qualified enclosing member containing the usage."),
});

const searchResultSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  namespace: z.string().optional(),
  type: z.enum(SearchResultTypes).or(z.string()),
  url: z
    .string()
    .describe("rvtdocs slug, or local:<memberId> for results from the local install index."),
  memberId: z.string().optional().describe(".NET doc-comment ID (local results only)."),
  summary: z.string().optional(),
  remarks: z.string().optional(),
  since: z.string().optional().describe("First Revit version exposing this member."),
  examples: z
    .array(usageExampleSchema)
    .optional()
    .describe(
      "Local source files using this member. Read the file at the line range for a full, uncut example.",
    ),
  extractedText: z
    .string()
    .optional()
    .describe("Extracted markdown from this result's documentation page."),
});

const searchResultsSchema = z.array(searchResultSchema);

const docsTextSchema = z.string();

const docsTextResultsSchema = z.array(docsTextSchema);

const searchResponseRvtDocsComSchema = z.object({
  current_version_results: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        namespace: z.string().optional(),
        year_version: z.string().optional(),
        type: z.string().optional(),
        url: z.string().optional(),
      }),
    )
    .optional(),
});

const searchResponseRevitApiDocsComSchema = z.object({
  sections: z
    .object({
      Products: z
        .array(
          z.object({
            value: z.string(),
            data: z.object({
              description: z.string().optional(),
              url: z.string(),
              id: z.string(),
              image_url: z.string().optional(),
            }),
            matched_terms: z.array(z.string()).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

/**
 * Reusable validators for the docs-related tools (not the openai-related tools).
 */
export const toolInputArgSchemas = {
  urlSlug: z.string().describe("URL slug of the Revit API documentation page to retrieve"),
  year: z
    .number()
    .min(2023)
    .max(2027)
    .default(defaultRevitApiDocsYear)
    .describe("Revit API documentation year version (2023-2027)"),
  maxResults: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .default(defaultRevitApiMaxResults)
    .describe("Maximum number of search results to return"),
  extractFirstResult: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, fetch the first search result's documentation page and attach extractedText to that result only.",
    ),
  queryTypes: z
    .array(z.enum(SearchResultTypes))
    .optional()
    .default([...SearchResultTypes])
    .describe(`Filter results by type: ${SearchResultTypes.join(", ")}`),
  queryString: z
    .string()
    .trim()
    .min(2)
    .describe(
      `Search query for Revit API entities. Identifiers ("FilteredElementCollector", "Wall.Flip") and natural-language phrases ("join geometry family document") both work — phrases rank by BM25 over names, summaries, and remarks when a local Revit install index is available.`,
    ),
};

const toolOutputSchemas = {
  searchResultSchema,
  searchResultsSchema,
  docsTextSchema,
  docsTextResultsSchema,
  searchResponseRvtDocsComSchema,
  searchResponseRevitApiDocsComSchema,
};

export const revitApiQueryInputSchema = z.object({
  queryString: toolInputArgSchemas.queryString,
  queryTypes: toolInputArgSchemas.queryTypes,
  year: toolInputArgSchemas.year,
  maxResults: toolInputArgSchemas.maxResults,
  extractFirstResult: toolInputArgSchemas.extractFirstResult,
});
