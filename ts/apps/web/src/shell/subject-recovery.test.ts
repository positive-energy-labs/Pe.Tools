// @vitest-environment jsdom
import { test, expect } from "vite-plus/test";

test("the mounted kernel removes a refused link before its next picker move", async () => {
  const { createGraphMount } = await import("./mount-owner");
  const { pane, manyField } = await import("@pe/agent-contracts");
  const graph = {
    key: "recovery",
    address: "recovery",
    name: "Recovery",
    fields: {
      fan: {
        ...manyField("UniqueId", {}),
        role: "subject",
        picker: { reading: "fans", options: (v: unknown) => v as { id: string; label: string }[] },
      },
      selected: { ...manyField("name", {}), role: "selection" },
    },
    subjectField: {
      field: "fan",
      noun: "fan",
      keyKind: "UniqueId",
      cardinality: "many",
      roster: "fans",
      detail: "fans",
      pane: "roster",
      show: (id: string) => id,
    },
    readings: { fans: { kind: "derive", source: "fans", retire: "never" } },
    verbs: {},
    panes: { roster: { label: "Fans", purpose: "Pick a fan", draws: ["fans"], verbs: [] } },
    stages: { main: { word: "Fans", panes: ["roster"], verbs: [] } },
    layout: pane("roster"),
  };
  const owner = createGraphMount(
    graph as never,
    {
      getSnapshot: () => ({ target: { kind: "host" }, work: null }),
      subscribe: () => () => {},
      subscribeAcceptedDeltas: () => () => {},
      write: async () => {
        throw Error("Read never writes");
      },
      sources: { fans: { kind: "derive", derive: () => [{ id: "uid@2", label: "MUAS-1" }] } },
    },
    { fan: ["13760867:1"] } as never,
  );
  const disconnect = owner.connect();
  const release = owner.readings.mount(["fans"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(owner.view.read().page).toMatchObject({ fan: [] });
  owner.view.setPage({ fan: ["uid@2"] } as never);
  expect(owner.view.read().page).toMatchObject({ fan: ["uid@2"] });
  release();
  disconnect();
  owner.dispose();
});

test("restored Page demands subject detail before any interaction", async () => {
  const { createGraphMount } = await import("./mount-owner");
  const { defineRouteGraph, pane, manyField } = await import("@pe/agent-contracts");
  const calls: unknown[] = [];
  const graph = defineRouteGraph({
    key: "restore-demand",
    address: "restore-demand",
    name: "Restore demand",
    fields: {
      fan: { ...manyField("name", {}), role: "subject" },
      selected: { ...manyField("name", {}), role: "selection" },
    },
    subjectField: {
      field: "fan",
      noun: "fan",
      keyKind: "name",
      cardinality: "many",
      roster: "fans",
      detail: "sheet",
      pane: "roster",
    },
    readings: { fans: {}, sheet: { args: (p) => p.fan } },
    verbs: {},
    panes: { roster: { label: "Fans", purpose: "Pick", draws: ["fans"] } },
    stages: { main: { word: "Fans", panes: ["roster"], verbs: [] } },
    layout: pane("roster"),
  });
  const owner = createGraphMount(
    graph,
    {
      getSnapshot: () => ({ target: { kind: "host" }, work: null }),
      subscribe: () => () => {},
      subscribeAcceptedDeltas: () => () => {},
      write: async () => {
        throw Error("Read never writes");
      },
      sources: {
        "restore-demand.fans": {
          kind: "use",
          open: (_, emit) => emit({ kind: "complete", value: [], revision: 0 }),
        },
        "restore-demand.sheet": {
          kind: "use",
          open: (ctx, emit) => {
            calls.push((ctx.page as { fan: string[] }).fan);
            emit({ kind: "complete", value: (ctx.page as { fan: string[] }).fan, revision: 0 });
          },
        },
      },
    },
    { fan: ["MUAS-1"] },
  );
  const disconnect = owner.connect();
  try {
    expect(calls).toEqual([["MUAS-1"]]);
    owner.view.setPage({ fan: ["FC-23"] });
    expect(calls).toEqual([["MUAS-1"], ["FC-23"]]);
  } finally {
    disconnect();
    owner.dispose();
  }
});
