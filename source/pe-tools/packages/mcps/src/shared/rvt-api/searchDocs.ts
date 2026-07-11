import { type SearchResult, SearchResultTypes } from "./validators.ts";
import { z } from "zod";

export async function searchWrapper(
  query: string,
  year: number,
  max: number,
  types: ReadonlyArray<(typeof SearchResultTypes)[number]> = SearchResultTypes,
): Promise<SearchResult[]> {
  const results1 = await searchRvtDocsCom(query, year, max * 2, types);
  const results2 = await searchRevitApiDocsCom(query, year, max * 2, types);

  const allResults = [...results1, ...results2];
  const dedupedResults = dedupeByUrl(allResults);
  const sortedResults = sortByType(dedupedResults);
  return sortedResults.slice(0, max);
}

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const urlMap = new Map<string, SearchResult>();
  const countEmpty = (obj: SearchResult) => Object.values(obj).filter((v) => v === "").length;

  for (const result of results) {
    const url = result.url;
    if (!urlMap.has(url)) {
      urlMap.set(url, result);
    } else {
      const existing = urlMap.get(url);
      if (existing && countEmpty(result) < countEmpty(existing)) {
        urlMap.set(url, result);
      }
    }
  }
  return Array.from(urlMap.values());
}

function sortByType(results: SearchResult[]): SearchResult[] {
  const typeOrder = ["Class", "Methods", "Properties", "Constructor"];

  return results.sort((a, b) => {
    const aIndex = typeOrder.indexOf(a.type);
    const bIndex = typeOrder.indexOf(b.type);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

/**
 * Searches Revit API documentation using the rvtdocs.com search endpoint
 */
export async function searchRvtDocsCom(
  query: string,
  year: number,
  maxResults: number,
  types: ReadonlyArray<(typeof SearchResultTypes)[number]> = SearchResultTypes,
): Promise<SearchResult[]> {
  try {
    const response = await fetch(`https://rvtdocs.com/static/json_trees/sidebar_${year}.json`);

    if (!response.ok) {
      throw new Error(`Search request failed: ${response.status} ${response.statusText}`);
    }

    const items = readRvtDocsTree(await response.json());
    return items
      .filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))
      .map(
        (item): SearchResult => ({
          title: item.title ?? "",
          namespace: item.fqn?.split(".").slice(0, -1).join(".") ?? "",
          type: TypeFromTitle.parse(item.title),
          url: `/${year}/${item.url}`,
        }),
      )
      .filter((result) => includesSearchResultType(types, result.type))
      .slice(0, maxResults);
  } catch (error) {
    console.error("Error searching Revit API docs using rvtdocs.com:", error);
    throw error;
  }
}

/**
 * Searches Revit API documentation using the www.revitapidocs.com search endpoint
 * This is necessary to keep because it makes "Properties" and "Methods" pages available
 */
export async function searchRevitApiDocsCom(
  query: string,
  year: number,
  maxResults: number,
  types: ReadonlyArray<(typeof SearchResultTypes)[number]> = SearchResultTypes,
): Promise<SearchResult[]> {
  try {
    // Construct the search URL with current timestamp
    const timestamp = Date.now();
    const searchUrl = `https://ac.cnstrc.com/autocomplete/${encodeURIComponent(
      query,
    )}?query=${encodeURIComponent(
      query,
    )}&autocomplete_key=key_yyAC1mb0cTgZTwSo&c=ciojs-2.1233.4&num_results=${maxResults}&i=d705c917-8e5a-491f-8bc4-9b43e78de48c&s=10&_dt=${timestamp}`;

    // Make the search request
    const response = await fetch(searchUrl);
    if (!response.ok) {
      throw new Error(`Search request failed: ${response.status} ${response.statusText}`);
    }

    const products = readRevitApiDocsProducts(await response.json());
    const results: SearchResult[] = [];

    for (const item of products) {
      const type = TypeFromTitle.parse(item.value);
      if (type !== "Members") {
        results.push({
          title: item.value,
          url: `/${year}/${item.url.split(".")[0]}`,
          type,
        });
      }
    }

    return results.filter((result) => includesSearchResultType(types, result.type));
  } catch (error) {
    console.error("Error searching Revit API docs using revitapidocs.com:", error);
    throw error;
  }
}

const TypeFromTitle = z.string().transform((title) => {
  const parts = title.trim().split(/\s+/);
  const lastPart = parts[parts.length - 1];

  for (const t of [...SearchResultTypes, "Members"]) {
    if (lastPart === t) return t;
  }
  return "Unknown";
});

type RvtDocsTreeNode = {
  title: string;
  url: string;
  fqn?: string;
  children?: RvtDocsTreeNode[] | string;
};

type RevitApiDocsProduct = {
  value: string;
  url: string;
};

function readRvtDocsTree(value: unknown): RvtDocsTreeNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: RvtDocsTreeNode[] = [];
  const pending = [...value];
  while (pending.length) {
    const record = readRecord(pending.shift());
    const title = readString(record.title);
    const url = readString(record.url);
    if (title && url) nodes.push({ title, url, fqn: readString(record.fqn) });
    if (Array.isArray(record.children)) pending.push(...record.children);
  }
  return nodes;
}

function readRevitApiDocsProducts(value: unknown): RevitApiDocsProduct[] {
  const products = readRecord(readRecord(value).sections).Products;
  if (!Array.isArray(products)) return [];
  return products.flatMap((product) => {
    const record = readRecord(product);
    const data = readRecord(record.data);
    const value = readString(record.value);
    const url = readString(data.url);
    return value && url ? [{ value, url }] : [];
  });
}

function includesSearchResultType(
  types: ReadonlyArray<(typeof SearchResultTypes)[number]>,
  type: string,
): boolean {
  return types.some((candidate) => candidate === type);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
