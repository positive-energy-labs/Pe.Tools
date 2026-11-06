import { ductsDesign, ductsDocumentSchema, fansDocumentSchema, fansSheetData, openFanSheetSchema } from "@pe/agent-contracts";
import { LAYOUT_FIXTURE } from "../layout.fixture.ts";
import { COLOURS_FIXTURE } from "../colours.fixture.ts";
import { NAVIGATION_FIXTURE } from "../navigation.fixture.ts";
import fixture from "./sheet.fixture.json";
import { sheetState } from "./state.ts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

/** Providers answer the same semantic read; selection changes never reuse a per-route seed. */
const provide = (name: string, snapshot: DuctSnapshot) => (args: { fan: "all" | readonly string[] }) => {
  const rows = fixture.roster.rows.filter((row) => snapshot.nodes.some((node) => node.id === row.unitId));
  const requested = args.fan === "all" ? rows : rows.filter((row) => args.fan.includes(`${row.uniqueId}@${row.portIndex}`));
  const candidate = openFanSheetSchema.parse({ overview: fixture.overview, inputs: fixture.inputs, elements: fixture.elements, legs: fixture.legs, worstLegs: [], worksheet: null });
  const opened = requested.flatMap((row) => row.unitId === candidate.overview.fan?.unitId && row.portIndex === candidate.overview.fan.portIndex ? [candidate] : []);
  const open = opened[0] ?? null;
  const unknown = requested.filter((row) => !opened.some((sheet) => sheet.overview.fan?.unitId === row.unitId && sheet.overview.fan.portIndex === row.portIndex)).map((row) => `${row.uniqueId}@${row.portIndex}`);
  const ductsWork = ductsDocumentSchema.parse({}), fansWork = fansDocumentSchema.parse({});
  const data = fansSheetData.parse({ open, opened, rows, progress: null, fans: { ...fixture.roster, rows }, sheetSnapshot: snapshot, sheetView: sheetState(open), ductsWork, fansWork, design: ductsDesign(ductsWork, fansWork) });
  return { key: `fixture:${name}:${JSON.stringify(args.fan)}`, generation: 0, version: 1, state: "current" as const,
    value: { data, evaluation: `fixture:${name}`, inputs: `fixture:${name}`, origin: { kind: "fixture", name }, trace: [], freshness: "current" as const,
      coverage: { requested: requested.map((row) => `${row.uniqueId}@${row.portIndex}`), covered: opened.map((sheet) => `${rows.find((row) => row.unitId === sheet.overview.fan!.unitId)!.uniqueId}@${sheet.overview.fan!.portIndex}`), unknown, refused: [] } } };
};
export const sheetValueFixtures = Object.fromEntries(Object.entries({ scene: LAYOUT_FIXTURE, layout: LAYOUT_FIXTURE, colours: COLOURS_FIXTURE, navigation: NAVIGATION_FIXTURE }).map(([name, value]) => [name, provide(name, value.snapshot)]));
