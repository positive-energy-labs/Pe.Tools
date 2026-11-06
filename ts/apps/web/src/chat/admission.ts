import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { createRouteShell } from "#/shell/admitted-mount";
import { sourceRouteServices } from "#/shell/source-route-services";
import { builtins } from "#/route/builtins.neutral";
import { createChatModule } from "./kernel";
import type { ChatRouteDeps } from "./graph";

export async function admitChat(deps: () => ChatRouteDeps) {
  const module = createChatModule(deps);
  const closure = builtins.chat.closure;
  const fingerprint = await builtinClosureFingerprint(closure.envelope);
  const inventory = createBuiltinRouteInventory({
    chat: {
      module,
      closure,
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const admission = (await inventory.prepare("chat", fingerprint)).admit(module);
  if (!admission.ok) throw Error(JSON.stringify(admission.diagnostics));
  return admission.route;
}
export async function createChatFixture(name: string) {
  if (typeof location !== "undefined" && location.pathname !== "/pea") name = "attach";
  const route = await admitChat(() => ({ thread: "" }));
  const address = {
    read: () => new URLSearchParams({ fixture: name }),
    write() {},
    subscribe: () => () => {},
  };
  const mount = createRouteShell(sourceRouteServices({})).mount(route, {
    address,
    fixture: name,
    target: { kind: "host" },
    work: { address: null, open: null },
    custody: { current: () => true },
    memory: () => ({}),
  });
  mount.setPaneDemand("threads", true);
  mount.setPaneDemand("chat", true);
  return mount;
}
