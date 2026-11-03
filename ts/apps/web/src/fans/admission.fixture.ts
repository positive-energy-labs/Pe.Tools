import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { module as ducts } from "../ducts/kernel";
import { module as fans } from "./kernel";
import { ductsHostModule } from "../ducts/neutral";
import { fansHostModule } from "./neutral";
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
    web: {
      module: ducts,
      closure: { envelope: ownerEnvelope, fingerprint: ownerFingerprint },
      catalog,
    },
    host: {
      module: ductsHostModule,
      host: true,
      closure: { envelope: ownerEnvelope, fingerprint: ownerFingerprint },
      catalog,
    },
  });
  const owner = (await ownerInventory.prepare("web", ownerFingerprint)).admit(ducts);
  const hostOwner = (await ownerInventory.prepare("host", ownerFingerprint)).admitHost(
    ductsHostModule,
  );
  if (!owner.ok) throw Error(JSON.stringify(owner.diagnostics));
  if (!hostOwner.ok) throw Error(JSON.stringify(hostOwner.diagnostics));
  const envelope = {
    ...ownerEnvelope,
    data: fans.data,
    workOwner: { route: "ducts", fingerprint: owner.route.workFingerprint },
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    web: { module: fans, workOwner: owner.route, closure: { envelope, fingerprint }, catalog },
    host: {
      module: fansHostModule,
      host: true,
      workOwner: hostOwner.route,
      closure: { envelope, fingerprint },
      catalog,
    },
  });
  const presenter = (await inventory.prepare("web", fingerprint)).admit(fans);
  const hostPresenter = (await inventory.prepare("host", fingerprint)).admitHost(fansHostModule);
  if (!presenter.ok) throw Error(JSON.stringify(presenter.diagnostics));
  if (!hostPresenter.ok) throw Error(JSON.stringify(hostPresenter.diagnostics));
  return {
    owner: owner.route,
    presenter: presenter.route,
    hostOwner: hostOwner.route,
    hostPresenter: hostPresenter.route,
  };
}
