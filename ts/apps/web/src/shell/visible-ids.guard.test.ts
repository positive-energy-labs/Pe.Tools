
import { elementLabeler } from "@pe/ducts-domain/element-label";
import type { FanPort } from "@pe/ducts-domain/roster";
import { buildSheet, type SheetSnapshot } from "@pe/ducts-domain/sheet/index";
import { inputsFor } from "@pe/ducts-domain/sheet/test-inputs";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { LAYOUT_FIXTURE, LAYOUT_ROSTER } from "../ducts/layout.fixture";
import { SCENE_FIXTURE } from "../ducts/scene.fixture";
import { fanLabel } from "../ducts/sheet/model";

import { admit } from "../fans/admission.fixture.ts";

import { leaks } from "./visible-text";

/**
 * Manual D re-drive #4, defect 7: internal keys rendered as text. Every fixture route's visible
 * subject words (roster labels, the kernel's subject label with and without a roster, verb, pane
 * and stage words) must come from declared display labels, never UniqueIds, port keys or ids.
 */
afterEach(() => vi.unstubAllGlobals());

// Manual D re-drive #5 defect 7: widened from words to what each fixture seed hands its panes.

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
    segments: [{ id: 3, kind: "duct", size: '10"Ã¸', connectors: [] }],
  } as never);
  expect([label(8775469), label(2), label(3), label(13771267)]).toEqual([
    "MUAS 10",
    "MUAS-1",
    "10â€³ duct",
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
  expect(fanLabel(a, [a, b])).toBe("FC-23 Â· Level 2 / port 0");
  const c = { ...b, level: "Level 2", system: "SA 2" };
  expect(fanLabel(c, [a, c])).toBe("FC-23 Â· SA 2 / port 0");
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
