import { designOf } from "@pe/ducts-domain/test-design";
import { expect, test } from "vite-plus/test";
import {
  ductsRouteState,
  fansDocumentSchema,
  applyPatches,
  cellPatches,
} from "@pe/agent-contracts";
import { editPatches } from "@pe/ducts-domain/sheet/index";
import { neutralBodies, authoredPatches, localId, schemas, ductsData } from "./neutral";
import { snapshot } from "./test-fixture";
import sheet from "./sheet/sheet.fixture.json";

type Scope = Parameters<typeof neutralBodies.lossReady.run>[0];
const ready = <T>(value: T) => ({
  status: "ready" as const,
  current: true as const,
  value,
  hash: "fixture",
});
const scope = (): Scope => {
  const readings: Scope["readings"] = {
    fansWork: ready(fansDocumentSchema.parse({})),
    ducts: ready(snapshot),
    sheetSnapshot: ready(snapshot),
    sheet: ready(
      schemas.sheet.parse({
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
    ),
  };
  return {
    page: {
      stage: "network",
      system: { kind: "ids", ids: [localId("ducts-system", snapshot.systems[0]!.name)] },
      fan: { kind: "ids", ids: [] },
    },
    work: ductsRouteState.schema.parse({}),
    readings,
    // Readiness has no accepted mutation basis; captures are the declared displayed reads.
    workBasis: null,
    captures: {
      ducts: readings.ducts,
      sheetSnapshot: readings.sheetSnapshot,
      sheet: readings.sheet,
    },
  };
};
const input = schemas.none.parse({});

test("bounded record-entry edits preserve siblings, encode deletion and reject invalid authored values", () => {
  // Rules are the ducts record segment since FANSPLIT; drops are fans Work.
  const doc = ductsRouteState.schema.parse({
    rules: {
      "7": { edit: { value: { table: "CD3-9" } } },
      "8": { edit: { value: { table: "CD3-1" } } },
    },
  });
  const patches = authoredPatches(doc, [{ path: ["rules", "7"] }]);
  expect(patches).toEqual([{ path: ["rules", "7"], op: "delete" }]);
  const changed = applyPatches(
    ductsRouteState,
    { version: 1, revision: 0, doc },
    "human",
    [{ path: ["rules", "7"] }],
    0,
  );
  expect(changed).toMatchObject({
    ok: true,
    envelope: { doc: { rules: { "8": doc.rules["8"] } } },
  });
  expect(() =>
    authoredPatches(doc, [{ path: ["rules", "7", "edit"], value: { value: { table: 7 } } }]),
  ).toThrow();
});

test("criteria edits merge the selected side and lifecycle actions remain bounded root patches", () => {
  const doc = ductsRouteState.schema.parse({
    criteria: { edit: { value: { allowanceInWg: { supply: 0.1, return: 0.2 } } } },
  });
  const patches = authoredPatches(
    doc,
    editPatches({ criteria: { allowanceInWg: { return: 0.35 } } }, designOf(doc)),
  );
  expect(patches).toEqual([
    {
      path: ["criteria"],
      value: { edit: { value: { allowanceInWg: { supply: 0.1, return: 0.35 } } } },
    },
  ]);
  const clear = authoredPatches(doc, cellPatches([], "criteria", doc.criteria, { kind: "clear" }));
  expect(clear).toEqual([{ path: ["criteria"], value: { edit: null } }]);
});

// Q2/Q4: fan walk authorization is read from Fans Work.
test("a sheet loss preview cannot enter the network-only Ducts command scope", () => {
  expect(schemas[ductsData.fields.stage.schema].safeParse("sheet").success).toBe(false);
});

test("native loss and repair scopes stay inside the active system", () => {
  const ctx = scope();
  expect(neutralBodies.lossReady.run(ctx, input)).toMatch(/scope/);
  const groups = snapshot.groups
    .filter((group) => group.systemNames.includes(snapshot.systems[0]!.name))
    .map((group) => group.id);
  expect(groups.length).toBeGreaterThan(0);
  const chosen: Scope = {
    ...ctx,
    work: { ...ctx.work, writeIntent: { edit: { value: { groups } } } },
  };
  expect(neutralBodies.lossReady.run(chosen, input)).toBe(true);
  expect(neutralBodies.healReady.run(chosen, input)).toBe(true);
  const foreign: Scope = {
    ...chosen,
    work: { ...ctx.work, writeIntent: { edit: { value: { groups: ["retired-network"] } } } },
  };
  expect(neutralBodies.lossReady.run(foreign, input)).toMatch(/scope/);
  expect(neutralBodies.healReady.run(foreign, input)).toMatch(/active system/);
});

test("native snapshot decoding keeps capture and bounded-system evidence and refuses a malformed snapshot", () => {
  const captured = { ...snapshot, sourceVersion: "native:1", systemReads: { completed: [900], missing: [] } };
  expect(schemas.snapshot.parse(captured)).toEqual(captured);
  expect(schemas.snapshot.safeParse({ ...captured, sourceVersion: 1 }).success).toBe(false);
  expect(schemas.snapshot.safeParse({ ...captured, nodes: "not a native snapshot" }).success).toBe(false);
});
