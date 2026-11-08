import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { module as ducts } from "../ducts/route";
import { module as fans } from "./route";
import { ductsHostModule } from "../ducts/route";
import { fansHostModule } from "./route";
const catalog = Object.entries(ducts.entries).map(([key, entry]) => ({
  key,
  ...entry.axes,
  uses: [],
}));
export async function admit(hostVersion = "fans-fixture") {
  const ownerEnvelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: ducts.data,
    hostVersion,
    variants: [{ client: "web" as const, entry: "fixture.ts" }],
    modules: [{ id: "fixture.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const ownerFingerprint = await builtinClosureFingerprint(ownerEnvelope);
  const ownerInventory = createBuiltinRouteInventory({
    host: {
      module: ductsHostModule,
      host: true,
      closure: { envelope: ownerEnvelope, fingerprint: ownerFingerprint },
      catalog,
    },
  });
  const hostOwner = (await ownerInventory.prepare("host", ownerFingerprint)).admitHost(
    ductsHostModule,
  );
  if (!hostOwner.ok) throw Error(JSON.stringify(hostOwner.diagnostics));
  const envelope = { ...ownerEnvelope, data: fans.data };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const fanCatalog = Object.entries(fans.entries).map(([key, entry]) => ({ key, ...entry.axes, uses: [] }));
  const inventory = createBuiltinRouteInventory({
    host: { module: fansHostModule, host: true, closure: { envelope, fingerprint }, catalog: fanCatalog },
  });
  const hostPresenter = (await inventory.prepare("host", fingerprint)).admitHost(fansHostModule);
  if (!hostPresenter.ok) throw Error(JSON.stringify(hostPresenter.diagnostics));
  return { owner: { typed: ducts as unknown as import("../route/typed-route").TypedRoute, data: ducts.data, workFingerprint: hostOwner.route.workFingerprint }, presenter: { typed: fans as unknown as import("../route/typed-route").TypedRoute, data: fans.data, workFingerprint: hostPresenter.route.workFingerprint }, hostOwner: hostOwner.route, hostPresenter: hostPresenter.route };
}
