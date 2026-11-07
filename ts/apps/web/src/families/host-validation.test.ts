import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { bindWork, familiesRouteState, familyCellKey } from "@pe/agent-contracts";
import { createRouteRegistrations } from "../../../../packages/mcps/src/pea/routes";

const filter = {
  categoryNames: ["Mechanical Equipment"],
  familyNames: ["Loaded family"],
  placementScope: "AllLoaded" as const,
};

// Human and Pea writes retain the same host-owned catalog validation on the typed shell.
test.each(
  (["human", "pea"] as const).flatMap((by) =>
    (["unknown-family-type", "unknown-family"] as const).map((code) => [by, code] as const),
  ),
)("Families Work retains %s %s validation", async (by, code) => {
  const loadedFamilies = vi.fn(async () => [
    { familyName: "Loaded family", types: [{ typeName: "Loaded type" }] },
  ]);
  const registration = createRouteRegistrations({ loadedFamilies }).find(
    (r) => r.spec.route === "families",
  )!;
  expect(registration.admit).toBeTypeOf("function");
  const initial = {
    version: 1,
    schemaVersion: 1,
    revision: 0,
    doc: familiesRouteState.schema.parse({ scope: { edit: { value: filter } } }),
    history: [],
  };
  function workspace() {
    let saved: unknown = structuredClone(initial);
    return new RouteWorkspace({
      registrations: [registration],
      store: {
        getState: async () => saved,
        setState: async ({ value }) => {
          saved = structuredClone(value);
        },
      },
    });
  }
  const host = workspace();
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
  const refused = await host.write(key, "families", by, write);
  expect(refused).toMatchObject({
    ok: false,
    code,
  });
  expect(loadedFamilies).toHaveBeenCalledOnce();
  expect((await host.read(key, "families"))?.revision).toBe(0);
});
