import { sessionsGraph } from "../sessions/graph";
import { indexGraph } from "../index/graph";
import type { RouteGraph } from "@pe/agent-contracts";
import { familyGraph } from "../family/graph";
import { takeoffGraph } from "../takeoff/graph";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createFixtureMount } from "./fixture";
import { legacySubjectState } from "./subject";
import { leaks } from "./visible-text";
import { fanLabel } from "../ducts/sheet/model";
import { SCENE_FIXTURE } from "../ducts/scene.fixture";
import { LAYOUT_FIXTURE, LAYOUT_ROSTER } from "../ducts/layout.fixture";
import { elementLabeler } from "@pe/ducts-domain/element-label";
import type { FanPort } from "@pe/ducts-domain/roster";
import { buildSheet, type SheetSnapshot } from "@pe/ducts-domain/sheet/index";
import { inputsFor } from "@pe/ducts-domain/sheet/test-inputs";
import { admit } from "../fans/admission.fixture.ts";

/**
 * Manual D re-drive #4, defect 7: internal keys rendered as text. Every fixture route's visible
 * subject words (roster labels, the kernel's subject label with and without a roster, verb, pane
 * and stage words) must come from declared display labels, never UniqueIds, port keys or ids.
 */
afterEach(() => vi.unstubAllGlobals());
const routes = [
  indexGraph,
  sessionsGraph,
  familyGraph,
  takeoffGraph,
] as unknown as RouteGraph<any, any>[];

test.each(routes.map((graph) => [graph.address, graph] as const))(
  "/%s renders no internal identity in its subject, verb, pane or stage words",
  async (_, graph) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw Error("Real host called");
      }),
    );
    const internal = [...Object.keys(graph.verbs), ...Object.keys(graph.panes ?? {})].filter((id) =>
      id.includes("-"),
    );
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
          for (const option of options.slice(0, 5)) {
            const page = {
              ...search,
              [subject.field]: subject.cardinality === "many" ? [option.id] : option.id,
            };
            // Before the roster lands, then after: neither may fall back to the raw key.
            words.push(legacySubjectState(graph, page).label);
            words.push(legacySubjectState(graph, page, owner.readings.get(picker.reading)).label);
          }
        }
      } finally {
        demand();
        release();
        owner.dispose();
      }
    }
    for (const text of words)
      expect(leaks(text, internal), `${graph.address}: "${text}"`).toEqual([]);
  },
);

/** Every display string a payload carries: the text-like fields a pane renders, at any depth. */
const TEXT_KEYS = /^(detail|note|text|label|title|message|sentence|reason|caption|verb|name)$/;
function displayStrings(value: unknown, key = "", out: string[] = []): string[] {
  if (typeof value === "string") {
    if (TEXT_KEYS.test(key)) out.push(value);
  } else if (Array.isArray(value)) value.forEach((item) => displayStrings(item, key, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) displayStrings(v, k, out);
  return out;
}

// Manual D re-drive #5 defect 7: widened from words to what each fixture seed hands its panes.
test.each(routes.map((graph) => [graph.address, graph] as const))(
  "/%s fixture seeds carry no internal identity in any display text",
  async (_, graph) => {
    for (const [name, seed] of Object.entries(graph.seeds ?? {})) {
      const loaded = await (seed as { load: () => Promise<unknown> }).load();
      for (const text of displayStrings(loaded))
        expect(leaks(text), `${graph.address}?fixture=${name}: "${text}"`).toEqual([]);
    }
  },
);

// The ledger's findings and notes: every fan of every ducts fixture model, built fresh.
test.each([
  ["scene", SCENE_FIXTURE.snapshot],
  ["layout", LAYOUT_FIXTURE.snapshot],
] as const)("the %s fixture's ledger names elements by label, never by id", (_, snapshot) => {
  const model = snapshot as unknown as SheetSnapshot;
  // The seed's own roster (the fixture models carry no system graph for suggestRoster to elect from).
  const held = new Set(model.nodes.map((node) => node.id));
  const ports = LAYOUT_ROSTER.rows
    .filter((row) => held.has(row.unitId))
    .map((row) => ({ ...row, tag: row.mark, source: "ruling" as const })) as unknown as FanPort[];
  expect(ports.length).toBeGreaterThan(0);
  for (const port of ports) {
    const sheet = buildSheet({
      snapshot: model,
      inputs: inputsFor(model),
      fan: { unitId: port.unitId, portIndex: port.portIndex },
      roster: ports,
      grids: {},
    });
    const texts = [
      ...sheet.blockers.flatMap((b) => [b.detail, b.closer.note]),
      ...sheet.assumed.blockers.flatMap((b) => [b.detail, b.closer.note]),
      ...sheet.notes.map((n) => n.text),
    ];
    for (const text of texts) expect(leaks(text), `fan ${port.tag}: "${text}"`).toEqual([]);
  }
});

test("one element label: mark, else type/family/category, else size and kind; never an id", () => {
  const label = elementLabeler({
    nodes: [
      { id: 8775469, kind: "equipment", label: null, facts: [], type: "MUAS 10", connectors: [] },
      {
        id: 2,
        kind: "equipment",
        label: null,
        facts: [{ key: "mark", text: "MUAS-1" }],
        connectors: [],
      },
    ],
    segments: [{ id: 3, kind: "duct", size: '10"ø', connectors: [] }],
  } as never);
  expect([label(8775469), label(2), label(3), label(13771267)]).toEqual([
    "MUAS 10",
    "MUAS-1",
    "10″ duct",
    "an element outside this read",
  ]);
});

test("a duplicate fan mark is told apart by level, then system, then order; never by its UniqueId", () => {
  const a = {
    mark: "FC-23",
    uniqueId: "00000000-0000-0000-0000-00d1f963-1",
    portIndex: 0,
    level: "Level 2",
    system: "SA 1",
  };
  const b = {
    mark: "FC-23",
    uniqueId: "00000000-0000-0000-0000-00d1f963-2",
    portIndex: 0,
    level: "Level 3",
    system: "SA 1",
  };
  expect(fanLabel(a, [a, b])).toBe("FC-23 · Level 2 / port 0");
  const c = { ...b, level: "Level 2", system: "SA 2" };
  expect(fanLabel(c, [a, c])).toBe("FC-23 · SA 2 / port 0");
  const d = { ...c, system: "SA 1" };
  expect([fanLabel(a, [a, d]), fanLabel(d, [a, d])]).toEqual([
    "FC-23 (1 of 2) / port 0",
    "FC-23 (2 of 2) / port 0",
  ]);
  expect(fanLabel({ ...a, mark: "MUAS-1" }, [a, b])).toBe("MUAS-1 / port 0");
});

test("admitted ducts, fans, chat and Pods render declared subject and pane words without internal ids", async () => {
  const { owner, presenter } = await admit();
  for (const route of [owner, presenter]) {
    const words = [
      route.data.name,
      route.data.subject!.noun,
      ...Object.values(route.data.panes).flatMap((pane) => [pane.label, pane.purpose]),
      ...Object.values(route.data.verbs).map((verb) => verb.label),
    ];
    expect(
      words.flatMap((word) => leaks(word)),
      route.data.key,
    ).toEqual([]);
  }
});

test("typed modules publish display words without internal identities",async()=>{
 const {builtinModules}=await import("../route/builtin-modules.generated");
 for(const module of Object.values(builtinModules)) {
   const words=[module.data.name,...Object.values(module.data.panes).flatMap(p=>[p.label,p.purpose]),...Object.values(module.data.verbs).map(v=>v.label)];
   expect(words.flatMap(word=>leaks(word)),module.data.key).toEqual([]);
 }
});
