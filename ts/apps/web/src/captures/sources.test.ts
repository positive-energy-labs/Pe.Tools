import { afterEach, expect, test, vi } from "vite-plus/test";
import { captureQueries } from "./host";
import { capturesSources } from "./sources";
import type { ReadingContext, ReadingPublication, UseSource } from "#/shell/readings";
const taking = (id: string, at: string) => ({
  id,
  at,
  sha: "a".repeat(64),
  origin: "human",
  document: { title: "MEP" },
  view: { name: "Plan" },
  focus: null,
  registration: null,
  byteSize: 1,
  url: "/captures/a.png",
});
afterEach(() => vi.restoreAllMocks());
test("the read table validates and orders every taking, including repeated pictures", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      captures: [taking("old", "2026-10-01T00:00:00Z"), taking("new", "2026-10-02T00:00:00Z")],
    }),
  );
  const list = (await captureQueries["captures.list"].run(
    {},
    { target: { kind: "host" }, work: null },
  )) as { id: string }[];
  expect(list.map((row) => row.id)).toEqual(["new", "old"]);
  expect(fetch.mock.calls[0]?.[0]).toEqual(expect.stringMatching(/\/captures$/));
});
test("the source publishes host refusals and retires late answers after cancellation", async () => {
  const controller = new AbortController();
  const ctx = { target: { kind: "host" }, signal: controller.signal } as ReadingContext;
  const frames: ReadingPublication[] = [];
  const run = vi
    .spyOn(captureQueries["captures.list"], "run")
    .mockRejectedValue(Error("captures unavailable"));
  const source = capturesSources()["captures.list"] as UseSource;
  await source.open(ctx, (frame) => frames.push(frame));
  expect(frames).toEqual([
    { kind: "failure", error: expect.objectContaining({ message: "captures unavailable" }) },
  ]);
  run.mockImplementation(async () => {
    controller.abort();
    return [];
  });
  await source.open(ctx, (frame) => frames.push(frame));
  expect(frames).toHaveLength(1);
});
