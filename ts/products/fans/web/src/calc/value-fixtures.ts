import { ductsRosterResponseSchema } from "@pe/fans-contract/calc-read";
import { ductsDesign } from "@pe/duct-systems-contract/ducts";
import { ductsDocumentSchema } from "@pe/ducts-contract/system-work";
import { fansDocumentSchema } from "@pe/fans-contract/fans";
import { fansCalcData, openFanCalcSchema } from "@pe/fans-contract/fans-read";
import { networkFixtures } from "@pe/ducts-web/network-fixtures";
import fixture from "@pe/ducts-web/fixtures/fan-sheet.json";
import { calcState } from "./state.ts";
import { stableFanKey } from "@pe/ducts-web/calc/model";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

/** Providers answer the same semantic read; selection changes never reuse a per-route seed. */
const provide = (snapshot: DuctSnapshot) => (args: { fan: "all" | readonly string[] }) => {
  const rows = ductsRosterResponseSchema
    .parse(fixture.roster)
    .rows.filter((row) => snapshot.nodes.some((node) => node.id === row.unitId));
  const requested =
    args.fan === "all" ? rows : rows.filter((row) => args.fan.includes(stableFanKey(row)));
  const candidate = openFanCalcSchema.parse({
    overview: fixture.overview,
    inputs: fixture.inputs,
    elements: fixture.elements,
    legs: fixture.legs,
    worstLegs: [],
    calcBreakdown: null,
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
  const ductSystemsWork = ductsDocumentSchema.parse({}),
    fansWork = fansDocumentSchema.parse({});
  const data = fansCalcData.parse({
    open,
    opened,
    rows,
    progress: null,
    fans: { ...fixture.roster, rows },
    calcSnapshot: snapshot,
    calcView: calcState(open),
    ductSystemsWork,
    ductSystemsRevision: 0,
    // The fixture lane reads no home: every setting cell says its home was not read.
    settings: {},
    fansWork,
    design: ductsDesign(ductSystemsWork, fansWork),
  });
  return {
    data,
    coverage: {
      requested: requested.map(stableFanKey),
      covered: opened.map((sheet) =>
        stableFanKey({
          uniqueId: rows.find((row) => row.unitId === sheet.overview.fan!.unitId)!.uniqueId,
          portIndex: sheet.overview.fan!.portIndex,
        }),
      ),
      unknown,
      refused: [],
    },
  };
};
export const calcValueFixtures = Object.fromEntries(
  Object.entries(networkFixtures).map(([name, value]) => [name, provide(value.snapshot)]),
);
