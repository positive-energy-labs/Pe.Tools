import { SHEET_COMMANDS } from "@pe/agent-contracts/slots";
import type { DocumentRef, HostRouteModule, NativeProcess, Tool } from "@pe/agent-contracts";
import type { RevitBridge } from "@pe/host-internal/bridge";
import type { HostNativeRead } from "@pe/host-internal/native-read";
import type { CommandExecutor } from "@pe/host-internal/command-executor";
import type { FamilyActionDependencies } from "./family-actions.ts";

type Deps = FamilyActionDependencies & {
  nativeRead?: HostNativeRead["Service"];
  projectLifetime?: (target: DocumentRef) => Promise<NativeProcess>;
};
type Factory = (bridge: RevitBridge["Service"], deps: Deps) => Record<string, CommandExecutor>;
type Host = {
  product: {
    id: string;
    tools: Readonly<Record<string, Tool>>;
  };
  reads?: HostRouteModule["reads"];
  executors?: Factory;
  sheet?: Factory;
};
type SheetOwner = {
  id: string;
  executors: Record<string, CommandExecutor>;
};
export type SheetExecutors = ReadonlyMap<string, SheetOwner>;

/** Work selects the admitted product's sheet body. */
export function bindProducts(hosts: readonly Host[]) {
  return {
    productReads: hosts.map(({ reads }) => ({ reads })),
    productExecutors(bridge: RevitBridge["Service"], deps: Deps = {}) {
      const executors: Record<string, CommandExecutor> = Object.create(null);
      const sheets = new Map<string, SheetOwner>();
      for (const { product, executors: make, sheet } of hosts) {
        for (const [key, executor] of Object.entries(make?.(bridge, deps) ?? {})) {
          if (Object.hasOwn(executors, key)) throw Error(`Duplicate product executor ${key}`);
          executors[key] = executor;
        }
        if (!sheet) continue;
        const bound = sheet(bridge, deps);
        for (const key of Object.values(SHEET_COMMANDS))
          if (!Object.hasOwn(bound, key)) throw Error(`Product ${product.id} has no ${key} body`);
        for (const { work } of Object.values(product.tools)) {
          if (!work || sheets.has(work.route))
            throw Error(`Product ${product.id} needs a unique sheet Work owner`);
          sheets.set(work.route, { id: product.id, executors: bound });
        }
      }
      return { executors, sheets };
    },
  };
}
