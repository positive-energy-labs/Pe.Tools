import { expect, test, vi } from "vite-plus/test";
import { progressiveFamiliesObservation } from "./host";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("#/host/runtime", () => ({ hostFetch: fetcher }));
vi.mock("#/host/client", () => ({
  hostUrl: (path: string) => `http://host${path}`,
  callHostRpc: vi.fn(),
}));

test("successive progress revisions fetch each immutable family once and clear the cache for another run", async () => {
  const requested: string[] = [];
  const family = (id: string) => ({ familyUniqueId: id });
  fetcher.mockImplementation(async (url: string) => {
    const query = new URL(url).searchParams;
    const record = query.get("record");
    if (record) {
      requested.push(record);
      return Response.json(family(record));
    }
    const id = query.get("id")!;
    return Response.json({
      reading: {
        id,
        progress: { runId: id === "new-run" ? "two" : "one" },
        result: { families: [] },
      },
      records: id === "first" ? ["a"] : ["a", "b"],
    });
  });
  const first = await progressiveFamiliesObservation("first");
  const next = await progressiveFamiliesObservation("next");
  expect(first.result.families).toEqual([family("a")]);
  expect(next.result.families).toEqual([family("a"), family("b")]);
  expect(requested).toEqual(["a", "b"]);
  expect(next.result.families[0]).toBe(first.result.families[0]);
  await progressiveFamiliesObservation("new-run");
  expect(requested).toEqual(["a", "b", "a", "b"]);
});
