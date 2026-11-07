import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { bindWork, familiesRouteState, familyCellKey } from "@pe/agent-contracts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { createRouteRegistrations } from "../../../../packages/mcps/src/pea/routes";
import { familiesHostModule } from "./route";
import { composeHostRouteRegistration } from "../../../host/src/host-route-registration";

const filter = {
  categoryNames: ["Mechanical Equipment"],
  familyNames: ["Loaded family"],
  placementScope: "AllLoaded" as const,
};

// Host composition supplies the catalog closure for both authors before verified admission.
test.each(
  (["human", "pea"] as const).flatMap((by) =>
    (["unknown-family-type", "unknown-family"] as const).map((code) => [by, code] as const),
  ),
)("admitted Families retains %s %s validation", async (by, code) => {
  const loadedFamilies = vi.fn(async () => [
    { familyName: "Loaded family", types: [{ typeName: "Loaded type" }] },
  ]);
  const legacyRegistration = createRouteRegistrations({ loadedFamilies }).find((r) => r.spec.route === "families")!;
  expect(legacyRegistration.admit).toBeTypeOf("function");
  const module = composeHostRouteRegistration(familiesHostModule, [legacyRegistration]);
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "w2f-gap",
    variants: [{ client: "web" as const, entry: "families/route.ts" }],
    modules: [{ id: "families/route.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const closure = { envelope, fingerprint: await builtinClosureFingerprint(envelope) };
  const inventory = createBuiltinRouteInventory({
    families: { host: true, module, closure, catalog: [] },
  });
  const admitted = (await inventory.prepare("families", closure.fingerprint)).admitHost(module);
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
    const refused = await legacy.write(key, "families", by, write);
    expect(refused).toMatchObject({
      ok: false,
      code,
    });
    expect(loadedFamilies).toHaveBeenCalledOnce();
    loadedFamilies.mockClear();
    expect(await host.write(key, "families", by, write)).toEqual(refused);
    expect(loadedFamilies).toHaveBeenCalledOnce();
    expect((await legacy.read(key, "families"))?.revision).toBe(0);
    expect((await host.read(key, "families"))?.revision).toBe(0);
  } finally {
    registration.close();
  }
});
