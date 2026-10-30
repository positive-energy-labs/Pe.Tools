// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { createReadingGraph } from "#/shell/readings";
import { familiesGraph, familiesPageSchema } from "./graph";
import { familiesMatrixSource, type FamiliesObservation } from "./sources";
import { FamiliesHostFixture } from "./host.fixture";

afterEach(() => vi.unstubAllGlobals());
test("successive progress revisions fetch each immutable family once within their originating attempt", async () => {
  const host = new FamiliesHostFixture();
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input, "http://fixture");
    const record = url.searchParams.get("record");
    if (record) {
      requested.push(record);
      return Response.json({ ...host.reading.result.families[0], familyUniqueId: record });
    }
    return host.fetch(input, init);
  });
  const graph = createReadingGraph(
    { readings: { matrix: familiesGraph.readings.matrix! } },
    {
      scope: {
        target: { kind: "document", ref: host.target },
        workKey: host.key,
        workRevision: 1,
        work: host.doc,
        page: familiesPageSchema.parse({
          draft: { categories: host.filter.categoryNames, placement: "AllLoaded", families: null },
        }),
      },
      sources: { "families.matrix": familiesMatrixSource(host.resources) },
      log: () => {},
    },
  );
  const release = graph.mount(["matrix"]);
  await waitFor(() => expect(graph.get("matrix").current).toBe(true));
  const progress = {
    ...host.reading.progress!,
    runId: crypto.randomUUID(),
    state: "reading" as const,
  };
  host.save({ ...host.reading, id: "first", progress }, ["a"]);
  await waitFor(() => expect((graph.get("matrix").value as FamiliesObservation).id).toBe("first"));
  const first = (graph.get("matrix").value as FamiliesObservation).result.families[0];
  host.save({ ...host.reading, id: "next", progress }, ["a", "b"]);
  await waitFor(() => expect((graph.get("matrix").value as FamiliesObservation).id).toBe("next"));
  expect(requested).toEqual(["a", "b"]);
  expect((graph.get("matrix").value as FamiliesObservation).result.families[0]).toBe(first);
  release();
  graph.dispose();
});
