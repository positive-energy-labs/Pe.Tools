import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { formatAuClass, parseAuHits, trimAuItem } from "../src/shared/autodesk-docs/au.ts";
import { parseBlogPost, parseBlogSearch } from "../src/shared/autodesk-docs/blog.ts";
import { latestHelpYear, parseHelpSearch } from "../src/shared/autodesk-docs/help.ts";
import { classifyDocsUrl, runSources } from "../src/shared/autodesk-docs/index.ts";
import { parseTbcIndex, rankTbc, tbcPostText } from "../src/shared/autodesk-docs/tbc.ts";
import { htmlToText } from "../src/shared/autodesk-docs/text.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/autodesk-docs/${name}`, import.meta.url), "utf8");
const json = (name: string): unknown => JSON.parse(fixture(name));

test("help search parses hits with highlight markup and entities stripped", () => {
  const hits = parseHelpSearch(json("help-search.json"), 10);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0]).toMatchObject({ source: "help", title: "MEP Systems" });
  expect(hits[0]!.url).toMatch(/^https:\/\/help\.autodesk\.com\/cloudhelp\/2027\//);
  expect(hits[0]!.snippet).toContain("GetLossCoefficientOverride");
  expect(hits[0]!.snippet).not.toContain("<span");
  expect(parseHelpSearch({ status: "Completed", entries: {} }, 5)).toEqual([]);
});

test("latest help year is the first year counting down from current + 2 whose toctree answers", async () => {
  const asked: string[] = [];
  const year = await latestHelpYear(async (url) => {
    asked.push(url);
    return url.includes("/2027/");
  }, new Date("2026-11-04"));
  expect(year).toBe(2027);
  expect(asked.map((u) => /RVT\/(\d+)/.exec(u)![1])).toEqual(["2028", "2027"]);
  await expect(latestHelpYear(async () => false, new Date("2026-11-04"))).rejects.toThrow(
    /No Revit help year/,
  );
});

test("help topic html becomes text without head or script content", () => {
  const text = htmlToText(fixture("help-topic.htm.txt"));
  expect(text).toContain("Pressure Loss Report");
  expect(text).not.toContain("client.js");
  expect(text).not.toContain("<");
});

test("blog search parses hits and keeps relevance order", () => {
  const hits = parseBlogSearch(json("blog-search.json"));
  expect(hits[0]).toMatchObject({
    source: "blog",
    title: "Reading Loss Methods available on Revit MEP",
    date: "2015-06-24",
    url: "https://blog.autodesk.io/reading-loss-methods-available-on-revit-mep/",
  });
  expect(hits[0]!.snippet).not.toContain("&hellip;");
});

test("blog post body cleans to text and keeps code fenced", () => {
  const text = parseBlogPost(json("blog-post.json"));
  expect(text).toContain("# Reading Loss Methods available on Revit MEP");
  expect(text.toLowerCase()).toContain("loss method");
  expect(text).toContain("```");
  expect(text).not.toContain("&nbsp;");
  expect(() => parseBlogPost([])).toThrow(/not found/);
});

test("tbc index parses rows and ranks titles by word then substring", () => {
  const posts = parseTbcIndex(fixture("tbc-index.html.txt"));
  expect(posts.length).toBeGreaterThanOrEqual(10);
  expect(posts[0]).toMatchObject({ number: 1, date: "2008-08-22", file: "0001_welcome.htm" });
  const hits = rankTbc(posts, "connector", 5);
  expect(hits.length).toBeGreaterThanOrEqual(3);
  expect(hits.every((p) => /connector/i.test(p.title))).toBe(true);
  expect(rankTbc(posts, "connector zzzz", 5)).toEqual([]);
  expect(tbcPostText(fixture("tbc-post.htm.txt"))).toContain("MEP Connectors");
});

test("au items trim to the fields an agent needs", () => {
  const items = json("au-search-items.json") as unknown[];
  const hits = parseAuHits(items, 10);
  expect(hits.map((h) => h.title)).toContain(
    "Smarter Ductwork: Automating Static Pressure with Revit API and AI Tools",
  );
  const five = items
    .map(trimAuItem)
    .find((c) => c.slug.startsWith("Five-Advanced-Mechanical-Analysis"))!;
  expect(five.url).toBe(
    "https://www.autodesk.com/autodesk-university/class/Five-Advanced-Mechanical-Analysis-Techniques-in-Revit-for-Sustainable-Space-Design-2024",
  );
  expect(five.year).toBe("2024");
  expect(five.attachments.some((a) => /ClassHandout.*\.pdf$/.test(a.url))).toBe(true);
  expect(five.videoId).toBe("6362811439112");
  expect(formatAuClass(five)).toContain("ClassHandout");
});

test("fetch dispatches by host and refuses unknown hosts", () => {
  expect(classifyDocsUrl("local:M:Autodesk.Revit.DB.Wall.Flip")).toBe("local");
  expect(classifyDocsUrl("/2025/some/page")).toBe("rvtdocs");
  expect(classifyDocsUrl("https://rvtdocs.com/2025/x")).toBe("rvtdocs");
  expect(classifyDocsUrl("https://help.autodesk.com/cloudhelp/2027/ENU/a.htm")).toBe("help");
  expect(classifyDocsUrl("https://blog.autodesk.io/some-post/")).toBe("blog");
  expect(classifyDocsUrl("https://jeremytammik.github.io/tbc/a/0130_mep_connectors.htm")).toBe(
    "tbc",
  );
  expect(classifyDocsUrl("https://www.autodesk.com/autodesk-university/class/X-2024")).toBe("au");
  expect(() => classifyDocsUrl("https://example.com/x")).toThrow(
    /Supported: .*help\.autodesk\.com/,
  );
});

test("one failing source reports its own error and never sinks the rest", async () => {
  const results = await runSources<string>({
    help: async () => ["a"],
    blog: async () => {
      throw new Error("HTTP 503");
    },
    tbc: async () => [],
  });
  expect(results).toEqual([
    { source: "help", hits: ["a"] },
    { source: "blog", error: "HTTP 503" },
    { source: "tbc", hits: [] },
  ]);
});
