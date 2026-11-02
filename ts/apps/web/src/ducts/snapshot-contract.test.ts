// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { createReadingGraph } from "#/shell/readings";
import { ductsGraph, ductsPageSchema } from "./graph";
import { ductsSources } from "./sources";
import { DuctsHostFixture } from "./host.fixture";
import { stableFanKey } from "./sheet/model";
import sheetFixture from "./sheet/sheet.fixture.json";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach((f) => f()); vi.unstubAllGlobals(); });
function fixture(corrupt = false) {
  const host = new DuctsHostFixture();
  host.snapshot = JSON.parse(readFileSync(resolve("../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json"), "utf8"));
  if (corrupt) host.snapshot.document.readAt = "yesterday";
  vi.stubGlobal("EventSource", host.source());
  vi.stubGlobal("fetch", host.fetch);
  vi.stubGlobal("Worker", host.worker);
  const graph = createReadingGraph(ductsGraph, {
    scope: { target: { kind: "document", ref: { session: "s", openId: "d" } },
      workKey: host.key, workRevision: host.revision, work: host.doc,
      page: { ...ductsPageSchema.parse({}), stage: "sheet", fan: [stableFanKey(sheetFixture.roster.rows[0]!)] } },
    sources: ductsSources(), log: () => {},
  });
  cleanups.push(() => graph.dispose());
  cleanups.push(graph.mount(["sheetSnapshot"]));
  return graph;
}
test("the fan fixture transport decodes real walk elements and positions", async () => {
  const graph = fixture();
  await waitFor(() => expect(graph.get("sheetSnapshot").current).toBe(true));
  const snapshot = graph.get("sheetSnapshot").value as DuctsHostFixture["snapshot"];
  expect(snapshot.nodes.find((node) => node.id === 14577391)?.family).toBeTruthy();
  expect(snapshot.segments.length).toBeGreaterThan(0);
});
test("a malformed snapshot settles with a named error and separately retained details", async () => {
  const graph = fixture(true);
  await waitFor(() => expect(graph.get("sheetSnapshot").status).toBe("failed"));
  expect(graph.get("sheetSnapshot").error).toBe("snapshot contract mismatch: document.readAt");
  expect(graph.get("sheetSnapshot").errorDetails).toContain("readAt");
  expect(graph.get("sheetSnapshot").current).toBe(false);
});

