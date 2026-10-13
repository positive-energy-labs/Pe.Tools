import type { Exposure } from "./model";

export interface DirectorySearch {
  query: string;
  exposure: Exposure | "All";
  sort: "workflow" | "name";
}
export const DIRECTORY_DEFAULTS: DirectorySearch = { query: "", exposure: "All", sort: "workflow" };

/** The URL owns directory filters; other search fields keep their existing route owners. */
export function directorySearch(search: Record<string, unknown>): DirectorySearch {
  return {
    ...search,
    query: typeof search.query === "string" ? search.query : DIRECTORY_DEFAULTS.query,
    exposure:
      search.exposure === "Main" || search.exposure === "Preview" || search.exposure === "Archive"
        ? search.exposure
        : "All",
    sort: search.sort === "name" ? "name" : "workflow",
  };
}
