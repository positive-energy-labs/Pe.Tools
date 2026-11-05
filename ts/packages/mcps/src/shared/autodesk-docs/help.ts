import { htmlToText, plainText } from "./text.ts";
import type { DocsHit } from "./types.ts";
import { z } from "zod";

export type HelpSection = "dev" | "user" | "all";

const searchUrl =
  "https://beehive.autodesk.com/community/service/rest/cloudhelp/resource/cloudhelpchannel/search/";

const helpEntrySchema = z.object({
  url: z.string(),
  title: z.string(),
  snippet: z.string().optional(),
  shortDescription: z.string().optional(),
  publishDate: z.string().optional(),
});

// `item` is absent when nothing matches.
const helpResponseSchema = z.object({
  entries: z.object({ item: z.array(helpEntrySchema).optional() }).optional(),
});

const contentGroup: Record<Exclude<HelpSection, "all">, string> = {
  dev: "Developer's Documentation",
  user: "Learn & Explore",
};

/** Newest published help year: the first year (counting down from current + 2) whose toctree exists. */
export async function latestHelpYear(
  head: (url: string) => Promise<boolean> = headOk,
  now: Date = new Date(),
): Promise<number> {
  for (let year = now.getFullYear() + 2; year >= 2020; year--) {
    if (await head(`https://help.autodesk.com/view/RVT/${year}/ENU/data/toctree.json`)) return year;
  }
  throw new Error("No Revit help year found: help.autodesk.com toctree.json answered no year.");
}

async function headOk(url: string): Promise<boolean> {
  const response = await fetch(url, { method: "HEAD" });
  return response.ok;
}

export function parseHelpSearch(json: unknown, max: number): DocsHit[] {
  const parsed = helpResponseSchema.parse(json);
  return (parsed.entries?.item ?? []).slice(0, max).map((entry) => ({
    source: "help",
    title: plainText(entry.title),
    url: entry.url,
    ...(entry.publishDate ? { date: entry.publishDate } : {}),
    snippet: plainText(entry.snippet || entry.shortDescription || ""),
  }));
}

export async function searchHelp(input: {
  query: string;
  section: HelpSection;
  year?: number;
  max: number;
}): Promise<DocsHit[]> {
  const year = input.year ?? (await latestHelpYear());
  const params = new URLSearchParams({
    q: input.query,
    origin: "upi",
    p: "RVT",
    v: String(year),
    l: "ENU",
    source: "CloudHelp",
    maxresults: String(input.max),
    start: "0",
  });
  if (input.section !== "all") params.set("cg", contentGroup[input.section]);
  const response = await fetch(`${searchUrl}?${params}`);
  if (!response.ok) throw new Error(`Help search failed: HTTP ${response.status}`);
  return parseHelpSearch(await response.json(), input.max);
}

export async function fetchHelpTopic(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Help topic fetch failed: HTTP ${response.status} for ${url}`);
  return htmlToText(await response.text());
}
