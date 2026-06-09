import z from "zod";

export type SearchResult = z.infer<typeof toolOutputSchemas.searchResultSchema>;

export type SearchResponseRvtDocsCom = z.infer<
  typeof toolOutputSchemas.searchResponseRvtDocsComSchema
>;

export type SearchResponseRevitApiDocsCom = z.infer<
  typeof toolOutputSchemas.searchResponseRevitApiDocsComSchema
>;

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

export const defaultRevitApiDocsYear = 2025;
export const defaultRevitApiMaxResults = 10;

export const searchResultSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  namespace: z.string().optional(),
  type: z.enum(SearchResultTypes).or(z.string()),
  url: z.string(),
  extractedText: z
    .string()
    .optional()
    .describe("Extracted markdown from this result's documentation page."),
});

export const searchResultsSchema = z.array(searchResultSchema);

export const docsTextSchema = z.string();

export const docsTextResultsSchema = z.array(docsTextSchema);

export const scriptWorkspaceBootstrapDataSchema = z.object({
  workspaceKey: z.string(),
  productHomePath: z.string(),
  productAgentsPath: z.string(),
  productReadmePath: z.string(),
  workspaceRootPath: z.string(),
  workspaceAgentsPath: z.string(),
  workspaceReadmePath: z.string(),
  projectFilePath: z.string(),
  sampleScriptPath: z.string(),
  revitVersion: z.string(),
  targetFramework: z.string(),
  runtimeAssemblyPath: z.string(),
  generatedFiles: z.array(z.string()),
});

export const searchResponseRvtDocsComSchema = z.object({
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

export const searchResponseRevitApiDocsComSchema = z.object({
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
    .refine((val) => {
      const trimmed = val.trim();
      const base = "[a-zA-Z][a-zA-Z0-9_]*";
      const simpleStringPattern = new RegExp(`^${base}$`);
      const classMemberPattern = new RegExp(`^${base}\\.${base}$`);
      const constructorPattern = new RegExp(`^${base}\\(${base}(?:,\\s${base})*\\)$`);

      return (
        simpleStringPattern.test(trimmed) ||
        classMemberPattern.test(trimmed) ||
        constructorPattern.test(trimmed)
      );
    }, `Must match one of: "AnyName", "Class.Member", or "Constructor(arg1, ...". Only single spaces allowed, and only after commas.`)
    .describe(
      `Search query for Revit API entities. Valid formats: "AnyName", "Class.Member" (2025+ only), or "Constructor(arg1, ...". NOT a phrase, sentence, or natural language query.`,
    ),
};

export const toolOutputSchemas = {
  searchResultSchema,
  searchResultsSchema,
  docsTextSchema,
  docsTextResultsSchema,
  scriptWorkspaceBootstrapDataSchema,
  searchResponseRvtDocsComSchema,
  searchResponseRevitApiDocsComSchema,
};
