import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addressSchema,
  bindWork,
  ductsRouteState,
  ductsDocumentSchema,
  ductsDesign,
  neutralFansWork,
  fansDocumentSchema,
  type DuctsSheetEdits,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { expect, test } from "vite-plus/test";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { editPatches, workLayer } from "../src/ducts-inputs.ts";
import { criteriaLayer } from "@pe/agent-contracts";
import { price } from "@pe/ducts-domain/pricing";
import { snapshot } from "../../web/src/ducts/test-fixture.ts";

test("joined Fans edits reach the pricing solve and input layer", () => {
  const fans = fansDocumentSchema.parse({
    flows: { "UniqueId:fixture%3a4": { edit: { value: { cfm: 250 } } } },
    terminalDrops: { "UniqueId:fixture%3a4": { edit: { value: { inWg: 0.27 } } } },
    parameters: { fanFlow: { edit: { value: "Project fan flow" } } },
  });
  const joined = ductsDesign(ductsDocumentSchema.parse({}), fans);
  const layer = workLayer(joined);
  expect(layer.flows).toEqual({ "UniqueId:fixture%3a4": { cfm: 250 } });
  expect(layer.terminalDrops).toEqual({ "UniqueId:fixture%3a4": { inWg: 0.27 } });
  const priced = price(snapshot, {}, joined, joined);
  expect(priced.edit.parameters.fanFlow).toBe("Project fan flow");
  expect(priced.flows.get(4)).toMatchObject({ cfm: 250 });
  expect(priced.next.paths[4]?.rows.find((row) => row.id === 4)).toMatchObject({ dp: 0.27 });
  expect(priced.overrides.terminalPs).toEqual({ "4": 0.27 });
});

// U4 supplies a real fans Work; this test owns only ducts edits.
const design = (raw: unknown) => ductsDesign(ductsDocumentSchema.parse(raw), neutralFansWork);

/**
 * Fitting pricing from the sheet (ducts LEDGER 2026-10-29): a person's table, rule assignment and
 * per-path proposed-fitting drop land on Work's own keys (`rules`, `ruleAssignments`, an
 * `assumptions` override), Work accepts them, and the resolver's layer reads them back.
 */
test("fitting edits land on Work's own keys and read back through the Work layer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ducts-fitting-edits-"));
  try {
    const registrations = [{ spec: ductsRouteState }];
    const workspace = new RouteWorkspace({ store: fileRouteDocumentStore(dir), registrations });
    const scope = bindWork("ducts", addressSchema.parse("C:\\models\\fittings.rvt"), undefined, {
      session: "s",
      openId: "o",
    });
    const key = "proposed:14106988:1|14122436:1>14106988";
    const edits: DuctsSheetEdits = {
      tables: { "elbow-1d-le10": { table: "CD3-21" } },
      assignments: { "Round Elbow": { rule: "elbow-15d-45-le10" } },
      fittingDrops: { [key]: { inWg: 0.04 } },
    };
    const patches = editPatches(edits);
    expect(patches).toEqual([
      { path: ["rules", "elbow-1d-le10", "edit"], value: { value: { table: "CD3-21" } } },
      {
        path: ["ruleAssignments", "Round Elbow", "edit"],
        value: { value: { rule: "elbow-15d-45-le10" } },
      },
      {
        path: ["assumptions", `component-drop:${key}`, "edit"],
        value: { value: { kind: "component-drop", inWg: 0.04 } },
      },
    ]);
    expect(await workspace.apply(scope, "ducts", "human", patches, 0)).toMatchObject({ ok: true });
    const saved = await workspace.readRaw(scope, "ducts");
    const layer = workLayer(design(saved!.doc));
    expect(layer.rules).toEqual({ "elbow-1d-le10": { table: "CD3-21" } });
    expect(layer.ruleAssignments).toEqual({ "Round Elbow": { rule: "elbow-15d-45-le10" } });
    expect(layer.assumptions?.[`component-drop:${key}`]).toEqual({
      kind: "component-drop",
      inWg: 0.04,
    });

    // `null` takes each back.
    const cleared = editPatches({ assignments: { "Round Elbow": null }, fittingDrops: { [key]: null } });
    expect(await workspace.apply(scope, "ducts", "human", cleared, saved!.revision)).toMatchObject({
      ok: true,
    });
    const after = workLayer(
      design((await workspace.readRaw(scope, "ducts"))!.doc),
    );
    expect(after.ruleAssignments).toEqual({});
    expect(after.assumptions?.[`component-drop:${key}`]).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a criteria edit writes and clears one side's own cell, leaving the other side's cell alone", () => {
  // supply 850: its own cell; return stays unstaged, so it keeps the firm's value and source.
  expect(editPatches({ criteria: { velocityLimitFpm: { supply: 850 } } })).toEqual([
    { path: ["criteria", "velocitySupplyFpm", "edit"], value: { value: 850 } },
  ]);
  // Clearing a side removes only its pending edit; an unsided criterion is one cell.
  expect(editPatches({ criteria: { velocityLimitFpm: { return: null }, healBoxIn: null, splitPolicy: "even" } })).toEqual([
    { path: ["criteria", "velocityReturnFpm"] },
    { path: ["criteria", "healBoxIn"] },
    { path: ["criteria", "splitPolicy", "edit"], value: { value: "even" } },
  ]);
  // The engine reads the layer the cells make.
  expect(criteriaLayer({ velocitySupplyFpm: { edit: { value: 850 } }, velocityReturnFpm: {}, healBoxIn: { edit: { value: 30 } } }))
    .toEqual({ velocityLimitFpm: { supply: 850 }, healBoxIn: 30 });
});
