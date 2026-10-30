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

afterEach(() => vi.unstubAllGlobals());
const routes: RouteGraph<any, any>[] = [
  openGraph,
  podsGraph,
  roomsGraph,
  spaceGraph,
  familyGraph,
  schedulesGraph,
  takeoffGraph,
  settingsGraph,
  chatGraph(() => ({ thread: "" })),
];
test.each(routes.map((graph) => [graph.address, graph] as const))(
  "/%s mounts every declared seed through the kernel without host reads",
  (_, graph) => {
    const fetch = vi.fn(() => {
      throw Error("Real host called");
    });
    vi.stubGlobal("fetch", fetch);
    expect(Object.keys(graph.seeds ?? {}).length).toBeGreaterThan(0);
    for (const name of Object.keys(graph.seeds!)) {
      for (const verb of Object.values(graph.verbs))
        if (verb.kind === "query")
          expect(
            Object.hasOwn(graph.seeds![name]!.queries ?? {}, verb.does!),
            `${graph.key}/${name}/${verb.does}`,
          ).toBe(true);
      const owner = createFixtureMount(graph, name);
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
  const owner = createFixtureMount(podsGraph, "browse", { binding: podsBinding });
  const release = owner.connect();
  const demand = owner.readings.mount(["member"]);
  try {
    expect(owner.readings.get("member").value).toMatchObject({ member: { pod: "mech-standards" } });
    const first = { pod: owner.view.read().page.pod, path: owner.view.read().page.path };
    expect((await owner.control("edit", { content: '{"fixture":true}' }).run()).state).toBe("done");
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
