import { SHEET_COMMANDS } from "@pe/agent-contracts/slots";
import type { DocumentRef, NativeProcess } from "@pe/agent-contracts";
import type { RevitBridge } from "@pe/host-internal/bridge";
import type { HostNativeRead } from "@pe/host-internal/native-read";
import type { CommandExecutor } from "@pe/host-internal/command-executor";
import type { implement } from "@pe/host-internal/product";
import type { FamilyActionDependencies } from "./family-actions.ts";

type Deps = FamilyActionDependencies & {
  nativeRead?: HostNativeRead["Service"];
  projectLifetime?: (target: DocumentRef) => Promise<NativeProcess>;
};
type SheetOwner = {
  id: string;
  executors: Record<string, CommandExecutor>;
};
export type SheetExecutors = ReadonlyMap<string, SheetOwner>;

/** Work selects the admitted product's sheet body. */
export function bindProducts(hosts: readonly ReturnType<typeof implement>[]) {
  return {
    productReads: hosts.map(({ reads }) => ({ reads })),
    productExecutors(bridge: RevitBridge["Service"], deps: Deps = {}) {
      const executors: Record<string, CommandExecutor> = Object.create(null);
      const sheets = new Map<string, SheetOwner>();
      for (const { product, executors: make } of hosts) {
        const {
          [SHEET_COMMANDS.plan]: plan,
          [SHEET_COMMANDS.apply]: apply,
          ...commands
        } = make(bridge, deps);
        for (const [key, executor] of Object.entries(commands)) {
          if (Object.hasOwn(executors, key)) throw Error(`Duplicate product executor ${key}`);
          executors[key] = executor;
        }
        if (!product.sheetWrites) continue;
        if (!plan || !apply || sheets.has(product.id))
          throw Error(`Product ${product.id} needs both sheet bodies and a unique Work owner`);
        sheets.set(product.id, {
          id: product.id,
          executors: { [SHEET_COMMANDS.plan]: plan, [SHEET_COMMANDS.apply]: apply },
        });
      }
      return { executors, sheets };
    },
  };
}
