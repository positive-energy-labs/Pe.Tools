import {
  ductsRosterResponseSchema,
  ductsDesign,
  ductsDocumentSchema,
  fansDocumentSchema,
  fansSheetData,
  openFanSheetSchema,
} from "@pe/agent-contracts";
import { LAYOUT_FIXTURE } from "../layout.fixture.ts";
import { COLOURS_FIXTURE } from "../colours.fixture.ts";
import { NAVIGATION_FIXTURE } from "../navigation.fixture.ts";
import fixture from "./sheet.fixture.json";
import { sheetState } from "./state.ts";
import { stableFanKey } from "./model.ts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

/** Providers answer the same semantic read; selection changes never reuse a per-route seed. */
const provide = (snapshot: DuctSnapshot) => (args: { fan: "all" | readonly string[] }) => {
  const rows = ductsRosterResponseSchema.parse(fixture.roster).rows.filter((row) =>
    snapshot.nodes.some((node) => node.id === row.unitId),
  );
  const requested =
    args.fan === "all"
      ? rows
      : rows.filter((row) => args.fan.includes(stableFanKey(row)));
  const candidate = openFanSheetSchema.parse({
    overview: fixture.overview,
    inputs: fixture.inputs,
    elements: fixture.elements,
    legs: fixture.legs,
    worstLegs: [],
    worksheet: null,
  });
  const opened = requested.flatMap((row) =>
    row.unitId === candidate.overview.fan?.unitId &&
    row.portIndex === candidate.overview.fan.portIndex
      ? [candidate]
      : [],
  );
  const open = opened[0] ?? null;
  const unknown = requested
    .filter(
      (row) =>
        !opened.some(
          (sheet) =>
            sheet.overview.fan?.unitId === row.unitId &&
            sheet.overview.fan.portIndex === row.portIndex,
        ),
    )
    .map(stableFanKey);
  const ductsWork = ductsDocumentSchema.parse({}),
    fansWork = fansDocumentSchema.parse({});
  const data = fansSheetData.parse({espOptions:null,espOptionsError:"Fixture has no native parameter options",
    open,
    opened,
    rows,
    progress: null,
    fans: { ...fixture.roster, rows },
    sheetSnapshot: snapshot,
    sheetView: sheetState(open),
    ductsWork,
    ductsRevision: 0,
    fansWork,
    design: ductsDesign(ductsWork, fansWork),
  });
  return {
    data,
    coverage: {
      requested: requested.map(stableFanKey),
      covered: opened.map(
        (sheet) =>
          stableFanKey({ uniqueId: rows.find((row) => row.unitId === sheet.overview.fan!.unitId)!.uniqueId, portIndex: sheet.overview.fan!.portIndex }),
      ),
      unknown,
      refused: [],
    },
  };
};
export const sheetValueFixtures = Object.fromEntries(
  Object.entries({
    scene: LAYOUT_FIXTURE,
    layout: LAYOUT_FIXTURE,
    colours: COLOURS_FIXTURE,
    navigation: NAVIGATION_FIXTURE,
  }).map(([name, value]) => [name, provide(value.snapshot)]),
);
