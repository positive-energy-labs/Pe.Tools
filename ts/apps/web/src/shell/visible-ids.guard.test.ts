import { builtinRouteKeys, typedBuiltin } from "../route/builtin-inventory";
import type { Page, Fields } from "../route/typed-route";
import type { HostRead } from "../route/host-read";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { leaks } from "./visible-text";
import { fanLabel } from "../ducts/sheet/model";
import { SCENE_FIXTURE } from "../ducts/scene.fixture";
import { LAYOUT_FIXTURE, LAYOUT_ROSTER } from "../ducts/layout.fixture";
import { elementLabeler } from "@pe/ducts-domain/element-label";
import type { FanPort } from "@pe/ducts-domain/roster";
import { buildSheet, type SheetSnapshot } from "@pe/ducts-domain/sheet/index";
import { inputsFor } from "@pe/ducts-domain/sheet/test-inputs";

// Registry words and actual declared fixture publications must name things, never their keys.
afterEach(() => vi.unstubAllGlobals());
const routes = builtinRouteKeys.map(typedBuiltin);
const fixtures = (module: (typeof routes)[number]) => {
  const page: Page<Fields> = { ...Object.fromEntries(Object.entries(module.spec.fields).map(([key, field]) => [key, field.initial])), selected: [] };
  const reads = new Set<HostRead & { args?(page: Page<Fields>): unknown }>([
    ...Object.values(module.spec.reads ?? {}),
    ...Object.values(module.spec.panes).flatMap((pane) => pane.read ? [pane.read] : []),
    ...(module.spec.core ? [module.spec.core] : []),
  ]);
  return [...reads].flatMap((read) => Object.keys(read.fixtures ?? {}).map((name) => ({
    read, name, publication: read.source.provide!(name, read.args?.(page) ?? {}),
  })));
};

// C746 Family runtime picker/roster/stage labels are also driven by the D G07 Family journey
// in route/kernel-journeys-focus.test.tsx; this registry inventory stays exhaustive.
test.each(routes.map((module) => [module.data.address, module] as const))(
  "/%s renders no internal identity in its subject, verb, pane or stage words",
  (_, module) => {
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("Real host called"); }));
    const data = module.data;
    const internal = [...Object.keys(data.verbs), ...Object.keys(data.panes)].filter(id => id.includes("-"));
    const words = [data.name, data.directory.label, ...(data.subject ? [data.subject.noun] : []),
      ...Object.values(data.verbs).map(verb => verb.label),
      ...Object.values(data.panes).flatMap(pane => [pane.label, pane.purpose]),
      ...Object.values(data.stages).map(stage => stage.word)];
    for (const fixture of fixtures(module))
      if (module.spec.subject && fixture.read === (module.spec.subject.read ?? module.spec.core))
        words.push(...module.spec.subject.options(fixture.publication.value!.data).map(option => option.label));
    for (const word of words) expect(leaks(word, internal), `${data.key}: ${word}`).toEqual([]);
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

// C747 Family has no fixture publication: the same D G07 Family journey renders actual Work
// and the asynchronous host-evaluated member payload. Keep every provider check below as well.
// Inspect the display fields of the actual typed fixture providers, not legacy seed URLs.
test.each(routes.map((module) => [module.data.address, module] as const))(
  "/%s fixture seeds carry no internal identity in any display text",
  (_, module) => {
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("Real host called"); }));
    for (const { read, name, publication } of fixtures(module))
      for (const text of displayStrings(publication.value?.data))
        expect(leaks(text), `${module.spec.key}/${read.key}/${name}: ${text}`).toEqual([]);
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

test("registered routes render declared subject and pane words without internal ids", () => {
  for (const route of routes) {
    const words = [route.data.name, ...(route.data.subject ? [route.data.subject.noun] : []),
      ...Object.values(route.data.panes).flatMap(pane => [pane.label, pane.purpose]),
      ...Object.values(route.data.verbs).map(verb => verb.label)];
    expect(words.flatMap(word => leaks(word)), route.data.key).toEqual([]);
  }
});

test("typed modules publish display words without internal identities",async()=>{
 for(const module of routes) {
   const words=[module.data.name,...Object.values(module.data.panes).flatMap(p=>[p.label,p.purpose]),...Object.values(module.data.verbs).map(v=>v.label)];
   expect(words.flatMap(word=>leaks(word)),module.data.key).toEqual([]);
 }
});
