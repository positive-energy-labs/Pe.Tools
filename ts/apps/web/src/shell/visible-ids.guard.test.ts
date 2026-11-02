import { zoneAuditGraph } from "../zone-audit/graph";
import { rhvacSyncGraph } from "../rhvac-sync/graph";
import { scheduleSpecsGraph } from "../schedule-specs/graph";
import { sessionsGraph } from "../sessions/graph";
import { podAdminGraph } from "../pod-admin/graph";
import { indexGraph } from "../index/graph";
import { familiesGraph } from "../families/graph";
import { fansGraph } from "../fans/graph";
import { ductsGraph } from "../ducts/graph";
import type { RouteGraph } from "@pe/agent-contracts";
import { openGraph } from "../open/graph";
import { podsGraph } from "../pods/graph";
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
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createFixtureMount } from "./fixture";
import { publishSubjectRoster, registerSubject, subjectState } from "./subject";
import { leaks } from "./visible-text";
import { fanLabel } from "../ducts/sheet/model";

/**
 * Manual D re-drive #4, defect 7: internal keys rendered as text. Every fixture route's visible
 * subject words (roster labels, the kernel's subject label with and without a roster, verb, pane
 * and stage words) must come from declared display labels, never UniqueIds, port keys or ids.
 */
afterEach(() => vi.unstubAllGlobals());
const routes = [
  ductsGraph, fansGraph, familiesGraph, indexGraph, podAdminGraph, sessionsGraph, scheduleSpecsGraph,
  rhvacSyncGraph, zoneAuditGraph, capturesGraph, dataTablesGraph, designSystemGraph, ductLossGraph,
  grillesGraph, opsGraph, bindGraph, parameterLinksGraph, openGraph, podsGraph, roomsGraph, spaceGraph,
  familyGraph, schedulesGraph, takeoffGraph, settingsGraph, chatGraph(() => ({ thread: "" })),
] as unknown as RouteGraph<any, any>[];

test.each(routes.map((graph) => [graph.address, graph] as const))(
  "/%s renders no internal identity in its subject, verb, pane or stage words",
  async (_, graph) => {
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("Real host called"); }));
    const internal = [...Object.keys(graph.verbs), ...Object.keys(graph.panes ?? {})].filter((id) => id.includes("-"));
    const words = [
      ...Object.values(graph.verbs).map((verb) => verb.label),
      ...Object.values(graph.panes ?? {}).map((pane) => (pane as { label?: string }).label ?? ""),
      ...Object.values(graph.stages ?? {}).map((stage) => (stage as { word?: string }).word ?? ""),
    ];
    const subject = graph.subjectField;
    const picker = subject && graph.fields[subject.field]?.picker;
    for (const name of Object.keys(graph.seeds ?? {})) {
      const owner = await createFixtureMount(graph, name);
      const release = owner.connect();
      const demand = picker ? owner.readings.mount([picker.reading]) : () => {};
      try {
        if (picker && subject) {
          const options = picker.options(owner.readings.get(picker.reading).value);
          words.push(...options.map((option) => option.label));
          const search = { fixture: name };
          registerSubject(graph.address, graph);
          for (const option of options.slice(0, 5)) {
            const page = { ...search, [subject.field]: subject.cardinality === "many" ? [option.id] : option.id };
            // Before the roster lands, then after: neither may fall back to the raw key.
            words.push(subjectState(graph.address, { ...page, fixture: `${name}:unpublished` }).label);
            publishSubjectRoster(graph.address, search, options);
            words.push(subjectState(graph.address, page).label);
          }
        }
      } finally {
        demand();
        release();
        owner.dispose();
      }
    }
    for (const text of words) expect(leaks(text, internal), `${graph.address}: "${text}"`).toEqual([]);
  },
);

test("a duplicate fan mark is told apart by level, then system, then order; never by its UniqueId", () => {
  const a = { mark: "FC-23", uniqueId: "00000000-0000-0000-0000-00d1f963-1", portIndex: 0, level: "Level 2", system: "SA 1" };
  const b = { mark: "FC-23", uniqueId: "00000000-0000-0000-0000-00d1f963-2", portIndex: 0, level: "Level 3", system: "SA 1" };
  expect(fanLabel(a, [a, b])).toBe("FC-23 · Level 2 / port 0");
  const c = { ...b, level: "Level 2", system: "SA 2" };
  expect(fanLabel(c, [a, c])).toBe("FC-23 · SA 2 / port 0");
  const d = { ...c, system: "SA 1" };
  expect([fanLabel(a, [a, d]), fanLabel(d, [a, d])]).toEqual(["FC-23 (1 of 2) / port 0", "FC-23 (2 of 2) / port 0"]);
  expect(fanLabel({ ...a, mark: "MUAS-1" }, [a, b])).toBe("MUAS-1 / port 0");
});
