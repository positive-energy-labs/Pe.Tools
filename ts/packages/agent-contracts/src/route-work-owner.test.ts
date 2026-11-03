import { expect, test } from "vite-plus/test";
import { builtinModule } from "./route-kernel.fixtures.ts";
import { withWorkOwner } from "./route-work-owner.ts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
  type AdmittedRoute,
} from "./route-module.ts";
import type { RouteGraphJson } from "./route-kernel-data.ts";

async function prepare(module: { data: RouteGraphJson }, owner?: AdmittedRoute) {
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "u8o",
    variants: [{ client: "web" as const, entry: "bodies.js" }],
    modules: [{ id: "bodies.js", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
    ...(owner && { workOwner: { route: owner.data.key, fingerprint: owner.workFingerprint } }),
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  return createBuiltinRouteInventory({
    route: {
      module,
      workOwner: owner,
      closure: { envelope, fingerprint },
      catalog: Object.entries(builtinModule.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  }).prepare("route", fingerprint);
}
const { work: _work, ...pageSchemas } = builtinModule.schemas;
void _work;
const presenter = {
  ...builtinModule,
  data: {
    ...builtinModule.data,
    key: "presenter",
    address: "/presenter",
    work: { route: "tiny" },
  } as const,
  schemas: withWorkOwner(pageSchemas, builtinModule),
};
test("typed neutral owner equals the runtime schema and preserves its pin", async () => {
  const owner = (await prepare(builtinModule)).admit(builtinModule);
  if (!owner.ok) throw Error(JSON.stringify(owner.diagnostics));
  const result = (await prepare(presenter, owner.route)).admit(presenter);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  expect(result.route.resolvedWork).toBe(owner.route.resolvedWork);
  expect(result.route.resolvedWork?.schema).toBe(builtinModule.schemas.work);
  expect(result.route.workFingerprint).toBe(owner.route.workFingerprint);
  expect(presenter.data.work).toEqual({ route: "tiny" });
  expect(presenter.schemas).not.toHaveProperty("work");
});
test.each(["schema", "declaration"])("typed owner refuses a different %s", async (kind) => {
  const owner = (await prepare(builtinModule)).admit(builtinModule);
  if (!owner.ok) throw Error(JSON.stringify(owner.diagnostics));
  const wrong = {
    ...presenter,
    schemas: withWorkOwner(pageSchemas, {
      ...builtinModule,
      data: kind === "declaration" ? { ...builtinModule.data, key: "other" } : builtinModule.data,
      schemas:
        kind === "schema"
          ? { ...builtinModule.schemas, work: builtinModule.schemas.work.clone() }
          : builtinModule.schemas,
    }),
  };
  const result = (await prepare(wrong, owner.route)).admitUnknown(wrong);
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ path: "work.route", code: "identity" }),
    );
});
