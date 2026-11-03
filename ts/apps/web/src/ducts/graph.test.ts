import { expect, test } from "vite-plus/test";
import {
  ductsDocumentSchema,
  ductsRouteState,
  applyPatches,
  transitionPatches,
} from "@pe/agent-contracts";
import { editPatches } from "@pe/ducts-domain/sheet/index";
import { ductsData, schemas, neutralBodies, authoredPatches, localId } from "./neutral";
import { snapshot } from "./test-fixture";
import sheet from "./sheet/sheet.fixture.json";

const work = () => ductsDocumentSchema.parse({});
type Scope = Parameters<typeof neutralBodies.lossReady.run>[0];
const ready = <T>(value: T) => ({
  status: "ready" as const,
  current: true as const,
  value,
  hash: "fixture",
});
const scope = (stage: "network" | "sheet" = "network"): Scope =>
  ({
    page: {
      stage,
      system: { kind: "ids", ids: [localId("ducts-system", snapshot.systems[0]!.name)] },
      fan: { kind: "ids", ids: [] },
    },
    work: work(),
    readings: {
      ducts: ready(snapshot),
      sheetSnapshot: ready(snapshot),
      sheet: ready({
        open: {
          overview: sheet.overview,
          inputs: null,
          elements: null,
          legs: null,
          worstLegs: [],
          worksheet: null,
        },
        rows: [],
        progress: null,
      }),
    },
  }) as Scope;

test("the admitted declaration keeps Ducts Work, thirteen record families and the criteria root editor", () => {
  expect(schemas.work).toBe(ductsRouteState.schema);
  expect(Object.keys(ductsData.cells)).toHaveLength(13);
  expect(ductsData.workFields.criteria.label).toBe("design criteria");
  expect(ductsData.cells.parameters.segment).toBe("parameters");
  expect(ductsData.fields).not.toHaveProperty("terminalFlow");
  expect(ductsData.stageOrder).toEqual(["network"]);
  expect(ductsData.fields.system.cardinality).toBe("many");
  expect(ductsData.verbs.losses).toMatchObject({ entry: "ducts.apply-losses", review: "shown" });
  expect(ductsData.verbs.heal).toMatchObject({ entry: "ducts.apply-heal", review: "shown" });
  expect(ductsData.verbs.assign).toMatchObject({
    entry: "ducts.apply-assign-fan",
    review: "shown",
  });
});

test("bounded record-entry edits preserve siblings, encode deletion and reject invalid authored values", () => {
  const doc = ductsDocumentSchema.parse({
    componentDrops: {
      "7": { edit: { value: { inWg: 0.18 } } },
      "8": { edit: { value: { inWg: 0.25 } } },
    },
  });
  const patches = authoredPatches(doc, [{ path: ["componentDrops", "7"] }]);
  expect(patches).toEqual([{ path: ["componentDrops", "7"], op: "delete" }]);
  const changed = applyPatches(
    ductsRouteState,
    { version: 1, revision: 0, doc },
    "human",
    [{ path: ["componentDrops", "7"] }],
    0,
  );
  expect(changed).toMatchObject({
    ok: true,
    envelope: { doc: { componentDrops: { "8": doc.componentDrops["8"] } } },
  });
  expect(() =>
    authoredPatches(doc, [
      { path: ["componentDrops", "7", "edit"], value: { value: { inWg: "wrong" } } },
    ]),
  ).toThrow();
});

test("criteria edits merge the selected side and lifecycle actions remain bounded root patches", () => {
  const doc = ductsDocumentSchema.parse({
    criteria: { edit: { value: { allowanceInWg: { supply: 0.1, return: 0.2 } } } },
  });
  const patches = authoredPatches(
    doc,
    editPatches({ criteria: { allowanceInWg: { return: 0.35 } } }, doc),
  );
  expect(patches).toEqual([
    {
      path: ["criteria"],
      value: { edit: { value: { allowanceInWg: { supply: 0.1, return: 0.35 } } } },
    },
  ]);
  const clear = authoredPatches(
    doc,
    transitionPatches([], "criteria", doc.criteria, { kind: "clear" }),
  );
  expect(clear).toEqual([{ path: ["criteria"], value: { edit: null } }]);
});

test("loss preview refuses the previous fan scope and a combined multi-fan sheet", () => {
  const ctx = scope("sheet");
  expect(neutralBodies.lossReady.run(ctx)).toMatch(/scope/);
  const fan = sheet.overview.fan;
  const chosen = {
    ...ctx,
    work: {
      ...ctx.work,
      writeIntent: { edit: { value: { walk: { unitId: fan.unitId, portIndex: fan.portIndex } } } },
    },
  } as Scope;
  expect(neutralBodies.lossReady.run(chosen)).toBe(true);
  expect(
    neutralBodies.lossReady.run({
      ...chosen,
      work: {
        ...ctx.work,
        writeIntent: { edit: { value: { walk: { unitId: 1, portIndex: 0 } } } },
      },
    } as Scope),
  ).toMatch(/scope/);
  const combined = {
    ...chosen,
    readings: {
      ...chosen.readings,
      sheet: ready({
        ...chosen.readings.sheet.value,
        opened: [chosen.readings.sheet.value!.open, chosen.readings.sheet.value!.open],
      }),
    },
  } as Scope;
  expect(neutralBodies.lossReady.run(combined)).toMatch(/scope/);
});

test("native loss and repair scopes stay inside the active system", () => {
  const ctx = scope();
  expect(neutralBodies.lossReady.run(ctx)).toMatch(/scope/);
  const groups = snapshot.groups
    .filter((group) => group.systemNames.includes(snapshot.systems[0]!.name))
    .map((group) => group.id);
  expect(groups.length).toBeGreaterThan(0);
  const chosen = {
    ...ctx,
    work: { ...ctx.work, writeIntent: { edit: { value: { groups } } } },
  } as Scope;
  expect(neutralBodies.lossReady.run(chosen)).toBe(true);
  expect(neutralBodies.healReady.run(chosen)).toBe(true);
  const foreign = {
    ...chosen,
    work: { ...ctx.work, writeIntent: { edit: { value: { groups: ["retired-network"] } } } },
  } as Scope;
  expect(neutralBodies.lossReady.run(foreign)).toMatch(/scope/);
  expect(neutralBodies.healReady.run(foreign)).toMatch(/active system/);
});
