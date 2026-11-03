import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { bindWork, familiesRouteState, familyCellKey } from "@pe/agent-contracts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { createRouteRegistrations } from "../../../../packages/mcps/src/pea/routes";
import { familiesHostModule } from "./neutral";

const filter = {
  categoryNames: ["Mechanical Equipment"],
  familyNames: ["Loaded family"],
  placementScope: "AllLoaded" as const,
};

// This test certifies a cutover blocker, not a safe production enrollment.
// The admitted path must retain the legacy host-owned asynchronous write validator.
test.each(["unknown-family-type", "unknown-family"] as const)(
  "kernel gap: admitted Families Work drops %s validation",
  async (code) => {
    const loadedFamilies = vi.fn(async () => [
      { familyName: "Loaded family", types: [{ typeName: "Loaded type" }] },
    ]);
    const legacyRegistration = createRouteRegistrations({
      admittedKeys: [],
      loadedFamilies,
    }).find((r) => r.spec.route === "families")!;
    expect(legacyRegistration.admit).toBeTypeOf("function");
    const envelope = {
      source: "builtin-closure" as const,
      version: 1 as const,
      data: familiesHostModule.data,
      hostVersion: "w2f-gap",
      variants: [{ client: "web" as const, entry: "families/kernel.ts" }],
      modules: [{ id: "families/kernel.ts", sha256: "a".repeat(64) }],
      inputs: [],
      externals: [],
    };
    const closure = { envelope, fingerprint: await builtinClosureFingerprint(envelope) };
    const inventory = createBuiltinRouteInventory({
      families: { host: true, module: familiesHostModule, closure, catalog: [] },
    });
    const admitted = (await inventory.prepare("families", closure.fingerprint)).admitHost(
      familiesHostModule,
    );
    if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
    const initial = {
      version: 1,
      schemaVersion: 1,
      revision: 0,
      doc: familiesRouteState.schema.parse({ scope: { edit: { value: filter } } }),
      history: [],
    };
    function workspace(legacy: boolean) {
      let saved: unknown = structuredClone(initial);
      return new RouteWorkspace({
        registrations: legacy ? [legacyRegistration] : [],
        store: {
          getState: async () => saved,
          setState: async ({ value }) => {
            saved = structuredClone(value);
          },
        },
      });
    }
    const legacy = workspace(true);
    const host = workspace(false);
    const registration = host.registerAdmitted(admitted.route);
    try {
      expect(await registration.ready).toBeNull();
      const key = bindWork("families", null);
      const cell = familyCellKey({
        familyName: "Loaded family",
        typeName: "Invented type",
        parameter: "Mark",
      });
      const patches =
        code === "unknown-family-type"
          ? [
              {
                path: ["cells", cell],
                value: { edit: { value: { value: "x", storageType: "String" } } },
              },
            ]
          : [
              {
                path: ["scope"],
                value: { edit: { value: { ...filter, familyNames: ["Invented family"] } } },
              },
            ];
      const write = { kind: "apply" as const, expectedRevision: 0, press: "gap", patches };
      expect(await legacy.write(key, "families", "human", write)).toMatchObject({
        ok: false,
        code,
      });
      expect(loadedFamilies).toHaveBeenCalledOnce();
      loadedFamilies.mockClear();
      expect(await host.write(key, "families", "human", write)).toMatchObject({ ok: true });
      expect(loadedFamilies).not.toHaveBeenCalled();
      expect((await legacy.read(key, "families"))?.revision).toBe(0);
      expect((await host.read(key, "families"))?.revision).toBe(1);
    } finally {
      registration.close();
    }
  },
);
