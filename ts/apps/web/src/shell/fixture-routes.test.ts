import { zoneAuditGraph } from "../zone-audit/graph";
import { rhvacSyncGraph } from "../rhvac-sync/graph";
import { scheduleSpecsGraph } from "../schedule-specs/graph";
import { sessionsGraph } from "../sessions/graph";
import { podAdminGraph } from "../pod-admin/graph";
import { indexGraph } from "../index/graph";
import { familiesGraph } from "../families/graph";
import { fansGraph } from "../fans/graph";
import { ductsGraph } from "../ducts/graph";

import { afterEach, expect, test, vi } from "vite-plus/test";
import { createFixtureMount } from "./fixture";
import type { RouteGraph } from "@pe/agent-contracts";
import { openGraph } from "../open/graph";
import { podsGraph } from "../pods/graph";
import { podsBinding } from "../pods/actions";
import { roomsGraph } from "../rooms/graph";
import { spaceGraph } from "../space/graph";
import { familyGraph } from "../family/graph";
import { schedulesGraph } from "../schedules/graph";
import { takeoffGraph } from "../takeoff/graph";
import { settingsGraph } from "../settings/graph";
import { chatGraph } from "../chat/graph";

import { capturesGraph } from "../captures/graph";

import { dataTablesGraph } from "../data-tables/graph";

import { designSystemGraph } from "../design-system/graph";

import { ductLossGraph } from "../duct-loss/graph";

import { grillesGraph } from "../grilles/graph";

import { opsGraph } from "../ops/graph";

import { bindGraph } from "../pages-bind/graph";

import { parameterLinksGraph } from "../parameter-links/graph";

afterEach(() => vi.unstubAllGlobals());
const routes = [
  ductsGraph,
  fansGraph,
  familiesGraph,
  indexGraph,
  podAdminGraph,
  sessionsGraph,
  scheduleSpecsGraph,
  rhvacSyncGraph,
  zoneAuditGraph,

  capturesGraph,
  dataTablesGraph,
  designSystemGraph,
  ductLossGraph,
  grillesGraph,
  opsGraph,
  bindGraph,
  parameterLinksGraph,
  openGraph,
  podsGraph,
  roomsGraph,
  spaceGraph,
  familyGraph,
  schedulesGraph,
  takeoffGraph,
  settingsGraph,
  chatGraph(() => ({ thread: "" })),
] as unknown as RouteGraph<any, any>[];
test.each(routes.map((graph) => [graph.address, graph] as const))(
  "/%s mounts every declared seed through the kernel without host reads",
  async (_, graph) => {
    const fetch = vi.fn(() => {
      throw Error("Real host called");
    });
    vi.stubGlobal("fetch", fetch);
    expect(Object.keys(graph.seeds ?? {}).length).toBeGreaterThan(0);
    for (const name of Object.keys(graph.seeds!)) {
      for (const verb of Object.values(graph.verbs))
        if (verb.kind === "query")
          expect(
            Object.hasOwn((await graph.seeds![name]!.load()).queries ?? {}, verb.does!),
            `${graph.key}/${name}/${verb.does}`,
          ).toBe(true);
      const owner = await createFixtureMount(graph, name);
      const release = owner.connect();
      const demand = owner.readings.mount(Object.keys(graph.readings));
      try {
        expect(owner.snapshot().failure, name).toBeNull();
        for (const id of Object.keys(graph.readings))
          expect(
            owner.readings.get(id).status,
            `${name}/${id}: ${owner.readings.get(id).error}`,
          ).toBe("ready");
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        demand();
        release();
        owner.dispose();
      }
    }
  },
);

test("Pods switches seeded members, preserves their memory Work, and undoes edits without fetch", async () => {
  const fetch = vi.fn(() => {
    throw Error("Real host called");
  });
  vi.stubGlobal("fetch", fetch);
  const owner = await createFixtureMount(podsGraph, "browse", { binding: podsBinding });
  const release = owner.connect();
  const demand = owner.readings.mount(["member"]);
  try {
    expect(owner.readings.get("member").value).toMatchObject({ member: { pod: "mech-standards" } });
    const first = { pod: owner.view.read().page.pod, path: owner.view.read().page.path };
    const edit = await owner.control("edit", { content: '{"fixture":true}' }).run();
    expect(edit, JSON.stringify(edit)).toMatchObject({ state: "done" });
    expect(owner.snapshot().work?.doc.fields[""].edit?.value).toBe('{"fixture":true}');
    owner.view.setPage({ pod: "demo", path: "settings/family/box.json" });
    expect(owner.readings.get("member").value).toMatchObject({
      member: { pod: "demo", path: "settings/family/box.json" },
    });
    expect(owner.snapshot().work?.doc.fields[""]).toBeUndefined();
    owner.view.setPage(first);
    expect(owner.snapshot().work?.doc.fields[""].edit?.value).toBe('{"fixture":true}');
    await owner.restore("undo");
    expect(owner.snapshot().work?.doc.fields[""]).toBeUndefined();
    await owner.restore("redo");
    expect(owner.snapshot().work?.doc.fields[""].edit?.value).toBe('{"fixture":true}');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    demand();
    release();
    owner.dispose();
  }
});

test("calculator fixtures recalculate with Page edits rather than freezing an example", async () => {
  const owner = await createFixtureMount(ductLossGraph, "calculate");
  const disconnect = owner.connect();
  const release = owner.readings.mount(["result"]);
  try {
    const before = owner.readings.get("result").value as { loss: number };
    owner.view.setPage({ cfm: 2400 });
    const after = owner.readings.get("result").value as { loss: number };
    expect(after.loss).toBeGreaterThan(before.loss);
  } finally {
    release();
    disconnect();
    owner.dispose();
  }
});

test("companion chat stays idle and mounts its own seed beside another route", async () => {
  vi.stubGlobal("location", { pathname: "/parameter-links" });
  const owner = await createFixtureMount(
    chatGraph(() => ({ thread: "" })),
    "links",
  );
  try {
    expect(owner.snapshot().failure).toBeNull();
  } finally {
    owner.dispose();
  }
});
