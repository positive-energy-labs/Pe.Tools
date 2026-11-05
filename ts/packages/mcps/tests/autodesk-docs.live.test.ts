import { describe, expect, test } from "vite-plus/test";
import { revitDocsFetch, revitDocsSearch } from "../src/shared/revit-docs.ts";
import { latestHelpYear } from "../src/shared/autodesk-docs/help.ts";

// Real network (and a real headless browser for au). Skipped unless PE_LIVE_DOCS=1.
const live = process.env.PE_LIVE_DOCS === "1" ? describe : describe.skip;

type Result = { source: string; hits?: { title: string; url: string }[]; error?: string };

const search = async (input: Record<string, unknown>): Promise<Result[]> =>
  (await revitDocsSearch.execute(revitDocsSearch.inputSchema.parse(input), {})) as Result[];
const fetchDoc = async (url: string): Promise<string> =>
  (await revitDocsFetch.execute(revitDocsFetch.inputSchema.parse({ url }), {})) as string;
const hitsOf = (results: Result[], source: string) => {
  const result = results.find((r) => r.source === source)!;
  if (result.error) throw new Error(`${source}: ${result.error}`);
  return result.hits!;
};

live("revit docs, live known cases", () => {
  test("1 help: latest year 2027, SetLossCoefficientOverride in a fetched dev hit", async () => {
    expect(await latestHelpYear()).toBe(2027);
    const hits = hitsOf(
      await search({
        query: "analytical segment loss coefficient",
        sources: ["help"],
        help: { section: "dev" },
      }),
      "help",
    );
    console.log(
      "help:",
      hits.map((h) => h.title),
    );
    const bodies = await Promise.all(hits.map((h) => fetchDoc(h.url)));
    expect(bodies.some((b) => b.includes("SetLossCoefficientOverride"))).toBe(true);
  });

  test("2 blog: Reading Loss Methods in top 3", async () => {
    const hits = hitsOf(
      await search({ query: "pressure loss", sources: ["blog"], blog: { revitOnly: true } }),
      "blog",
    );
    console.log(
      "blog:",
      hits.map((h) => h.title),
    );
    const hit = hits
      .slice(0, 3)
      .find((h) => h.title === "Reading Loss Methods available on Revit MEP");
    expect(hit).toBeDefined();
    expect((await fetchDoc(hit!.url)).toLowerCase()).toContain("loss method");
  });

  test("3 tbc: connector has 3+ hits and the first fetches", async () => {
    const hits = hitsOf(await search({ query: "connector", sources: ["tbc"] }), "tbc");
    console.log(
      "tbc:",
      hits.map((h) => h.title),
    );
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect((await fetchDoc(hits[0]!.url)).length).toBeGreaterThan(200);
  });

  test("4 au: duct pressure classes and a handout attachment", async () => {
    const hits = hitsOf(await search({ query: "duct pressure", sources: ["au"] }), "au");
    console.log(
      "au:",
      hits.map((h) => h.title),
    );
    const titles = hits.map((h) => h.title.trim());
    expect(titles).toContain(
      "Smarter Ductwork: Automating Static Pressure with Revit API and AI Tools",
    );
    expect(titles).toContain("Extending Automated MEP Analysis in Revit 2026");
    const text = await fetchDoc(
      "https://www.autodesk.com/autodesk-university/class/Five-Advanced-Mechanical-Analysis-Techniques-in-Revit-for-Sustainable-Space-Design-2024",
    );
    expect(text).toMatch(/ClassHandout[^\s]*\.pdf/);
  }, 90_000);

  test("5 api: MEPAnalyticalSegment still returns API hits", async () => {
    const hits = hitsOf(await search({ query: "MEPAnalyticalSegment", sources: ["api"] }), "api");
    console.log(
      "api:",
      hits.map((h) => h.title),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  test("6 all sources: pressure loss answers from 3+ sources", async () => {
    const results = await search({ query: "pressure loss" });
    console.log(results.map((r) => `${r.source}:${r.hits ? r.hits.length : `ERR ${r.error}`}`));
    expect(results.filter((r) => (r.hits?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(3);
  }, 90_000);
});
