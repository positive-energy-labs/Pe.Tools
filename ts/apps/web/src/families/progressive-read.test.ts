// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { familiesRouteState, workKey, workWriteSchema } from "@pe/agent-contracts";
import { createGraphMount } from "#/shell/mount-owner";
import { familiesGraph, familiesPageSchema } from "./graph";
import { familiesBinding } from "./actions";
import { familiesMatrixSource, familiesSources, type FamiliesObservation } from "./sources";
import { FamiliesHostFixture } from "./host.fixture";

const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0).reverse()) release();
  vi.unstubAllGlobals();
});
function mounted(host = new FamiliesHostFixture()) {
  vi.stubGlobal("fetch", host.fetch);
  const owner = createGraphMount(
    familiesGraph,
    {
      getSnapshot: host.snapshot,
      subscribe: (notify) => {
        host.scopeListeners.add(notify);
        return () => {
          host.scopeListeners.delete(notify);
        };
      },
      write: host.write,
      subscribeAcceptedDeltas: () => () => {},
      sources: { ...familiesSources(), "families.matrix": familiesMatrixSource(host.resources) },
      binding: familiesBinding,
    },
    familiesPageSchema.parse({
      draft: { categories: host.filter.categoryNames, placement: "AllLoaded", families: null },
    }),
  );
  releases.push(() => owner.dispose(), owner.connect(), owner.readings.mount(["matrix"]));
  return { host, owner };
}

test("kernel gap: a completed Families query fills scope through one undoable Work write", async () => {
  const { host, owner } = mounted();
  host.doc = familiesRouteState.schema.parse({ takenAt: host.reading.capturedAt });
  host.notify();
  const result = await owner.control("read").run();
  expect(result).toMatchObject({ state: "done", kind: "query" });
  expect(host.reads[0]).toMatchObject({ work: host.key, filter: host.filter, expectedRevision: 1 });
  expect(host.writes).toHaveLength(1);
  expect(host.doc.scope.edit?.value).toEqual(host.filter);
  expect(owner.journals.get(workKey(host.key))!.read().undo).toHaveLength(1);
});

test("an incomplete Families read keeps completed families but writes no scope baseline", async () => {
  const { host, owner } = mounted();
  const partial: FamiliesObservation = {
    ...host.reading,
    id: "cancelled-reading",
    progress: {
      ...host.reading.progress!,
      runId: crypto.randomUUID(),
      state: "cancelled",
      completed: 1,
      total: 2,
    },
  };
  host.readGate = async () => {
    host.save(partial);
    return partial;
  };
  const before = structuredClone(host.doc);
  expect(await owner.control("read").run()).toMatchObject({ state: "done", kind: "query" });
  await waitFor(() =>
    expect(owner.readings.get("matrix").value).toMatchObject({ progress: { state: "cancelled" } }),
  );
  expect(host.doc).toEqual(before);
  expect(host.writes).toEqual([]);
  expect(owner.readings.get("matrix").current).toBe(false);
});

test("kernel gap: Families native reads surface a 409 as refused with the host's reason", async () => {
  const { host, owner } = mounted();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (
      new URL(input instanceof Request ? input.url : input, "http://fixture").pathname ===
        "/families/readings" &&
      init?.method === "POST"
    )
      return Response.json({ error: "This exact document is no longer open" }, { status: 409 });
    return host.fetch(input, init);
  });
  expect(await owner.control("read").run()).toMatchObject({
    state: "refused",
    refusal: { message: "This exact document is no longer open" },
  });
  expect(host.writes).toEqual([]);
});

test("kernel gap: a Families read cannot rebase its scope write over Work newer than its returned envelope", async () => {
  const { host, owner } = mounted();
  let complete!: (value: FamiliesObservation) => void;
  host.readGate = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const pending = owner.control("read").run();
  await waitFor(() => expect(host.reads).toHaveLength(1));
  // Native publication returns revision 2; a later human scope edit is revision 3.
  host.revision = 2;
  host.notify();
  const humanFilter = { ...host.filter, familyNames: ["Human's newer scope"] };
  await host.write(
    host.key,
    workWriteSchema.parse({
      expectedRevision: 2,
      press: "newer-human",
      patches: [{ path: ["scope", "edit"], value: { value: humanFilter } }],
    }),
  );
  complete({ ...host.reading, envelope: { revision: 2 } });
  const result = await pending;
  expect.soft(result.state).toBe("stale");
  expect.soft(host.writes).toHaveLength(1);
  expect(host.doc.scope.edit?.value).toEqual(humanFilter);
});

test("kernel gap: Stop cancels the native Families read by its readId", async () => {
  const { host, owner } = mounted();
  let complete!: (value: FamiliesObservation) => void;
  host.readGate = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const pending = owner.control("read").run();
  await waitFor(() => expect(host.reads).toHaveLength(1));
  owner.stop();
  complete({ ...host.reading, progress: { ...host.reading.progress!, state: "cancelled" } });
  await pending;
  expect(host.cancels).toEqual([host.reads[0]!.readId]);
  expect(host.writes).toEqual([]);
});
