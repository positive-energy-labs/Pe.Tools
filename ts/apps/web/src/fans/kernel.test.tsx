import { expect, test } from "vite-plus/test";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
  type AdmittedRoute,
} from "../../../../packages/agent-contracts/src/route-module";
import { module as capturesModule } from "../captures/kernel";
import { ductsDocumentSchema } from "@pe/agent-contracts";

async function admit(key: string, work: unknown, owner?: AdmittedRoute) {
  const module = {
    ...capturesModule,
    schemas: { ...capturesModule.schemas, work: ductsDocumentSchema },
    data: {
      ...capturesModule.data,
      key,
      address: `/${key}`,
      capabilities: ["work"] as const,
      work,
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data as never,
    hostVersion: "w1-fixture",
    variants: [{ client: "web" as const, entry: "route.js" }],
    modules: [{ id: "route.js", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
    ...(owner && { workOwner: { route: owner.data.key, fingerprint: owner.workFingerprint } }),
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    route: {
      module,
      workOwner: owner,
      closure: { envelope, fingerprint },
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  return (await inventory.prepare("route", fingerprint)).admitUnknown(module);
}
const spec = { route: "ducts", schema: "work", version: 1, migrations: {} };
test("shared Work resolves the admitted owner's schema and pinned fingerprint", async () => {
  const owner = await admit("ducts", spec);
  if (!owner.ok) throw Error(JSON.stringify(owner.diagnostics));
  const presenter = await admit("fans", { route: "ducts" }, owner.route);
  if (!presenter.ok) throw Error(JSON.stringify(presenter.diagnostics));
  expect(presenter.route.workFingerprint).toBe(owner.route.workFingerprint);
  expect(presenter.route.resolvedWork).toBe(owner.route.resolvedWork);
});
test("shared Work refuses a missing admitted owner", async () => {
  const result = await admit("fans", { route: "ducts" });
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ path: "work.route", code: "missing" }),
    );
});
test("shared Work refuses redeclaring the owner's schema", async () => {
  const owner = await admit("ducts", spec);
  if (!owner.ok) throw Error(JSON.stringify(owner.diagnostics));
  const result = await admit("fans", spec, owner.route);
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ path: "work.route", code: "policy" }),
    );
});
