import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { address, catalogWorkSpecs } from "@pe/agent-contracts";
import { fixtureNative } from "./fixture-native.ts";
import { nativeRecordings } from "./native-recordings.ts";
import { testDocumentMarks } from "./effect-test.ts";

test.each(["current", "moved"] as const)("recorded parameter-links %s base runs real plan/apply admission and preserves unstaged stored ids", async mode => {
  const dir = await mkdtemp(join(tmpdir(), "pe-catalog-recorded-"));
  const native = await fixtureNative(join(dir, "native"), "sdk-revit.detail.parameter-links", "sdk-revit.apply.parameter-links");
  const socket = await native.connect();
  let state: unknown;
  const workspace = new RouteWorkspace({ registrations: [{ spec: catalogWorkSpecs["parameter-links"] }], store: {
    getState: async () => state, setState: async ({ value }) => { state = structuredClone(value); },
  } });
  const key = { binding: "address" as const, target: address("C:/model.rvt"), route: "parameter-links" };
  const body = nativeRecordings("sdk-revit.detail.parameter-links").responses["revit.detail.parameter-links"] as any;
  const { id: _id, ...definition } = body.profile.definitions[0];
  const post = native.actions({ workspace, marks: testDocumentMarks(native.bridge) });
  const execute = async (id: string, command: string) => {
    const response = await post({ id, key: command, target: { kind: "document", ref: socket.target }, input: { work: { key, revision: (await workspace.read(key, "parameter-links"))!.revision } } });
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    return native.journal.wait(id);
  };
  try {
    await workspace.publish(key, "parameter-links", [{ path: ["definitions", "authored-extra"], value: { edit: { value: definition } } }], 0);
    const plan = await execute("plan", "parameter-links.apply.plan");
    expect(plan, JSON.stringify(plan)).toMatchObject({ state: "succeeded" });
    expect(native.calls.map(call => call.key)).toEqual(["revit.detail.parameter-links"]);
    if (mode === "moved") native.select("sdk-earlier-parameter-links");
    const applied = await execute("apply", "parameter-links.apply");
    if (mode === "moved") {
      expect(applied, JSON.stringify(applied)).toMatchObject({ state: "failed", notDispatched: true, refusal: { code: "preview.stale" } });
      expect(native.calls.some(call => call.key === "revit.apply.parameter-links")).toBe(false);
    } else {
      expect(applied, JSON.stringify(applied)).toMatchObject({ state: "succeeded" });
      expect(native.calls.at(-1)).toMatchObject({ key: "revit.apply.parameter-links", action: "parameter-links.apply", input: {
        reconcile: true, profile: { formatVersion: body.profile.formatVersion, assignments: body.profile.assignments,
          definitions: [...body.profile.definitions, { ...definition, id: "authored-extra" }] },
      } });
    }
    expect(catalogWorkSpecs["parameter-links"].schema.parse((await workspace.read(key, "parameter-links"))!.doc).definitions["authored-extra"].edit).toBeTruthy();
  } finally { await native.close(); await rm(dir, { recursive: true, force: true }); }
});

test("data-table governor refuses the real plan before any native request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-data-table-refused-"));
  const native = await fixtureNative(join(dir, "native")); const socket = await native.connect();
  let state: unknown;
  const workspace = new RouteWorkspace({ registrations: [{ spec: catalogWorkSpecs["data-tables"] }], store: {
    getState: async () => state, setState: async ({ value }) => { state = value; },
  } });
  const key = { binding: "address" as const, target: address("C:/model.rvt"), route: "data-tables" };
  try {
    await workspace.publish(key, "data-tables", [{ path: ["name"], value: { edit: { value: "Authored table" } } }], 0);
    const response = await native.actions({ workspace, marks: testDocumentMarks(native.bridge) })({ id: "plan", key: "data-table.apply.plan", target: { kind: "document", ref: socket.target }, input: { work: { key, revision: 1 } } });
    expect(response.status).toBeLessThan(400);
    expect(await native.journal.wait("plan")).toMatchObject({ state: "failed", refusal: { code: "catalog.table-base-required" } });
    expect(native.calls).toEqual([]);
  } finally { await native.close(); await rm(dir, { recursive: true, force: true }); }
});
