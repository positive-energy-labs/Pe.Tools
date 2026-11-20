import { SHEET_COMMANDS } from "@pe/agent-contracts/slots";
import type { RevitBridge } from "@pe/host-internal/bridge";
import type { CommandExecutor } from "@pe/host-internal/command-executor";
import type { CommandBody, implement } from "@pe/host-internal/product";
import type { FamilyActionDependencies } from "./family-actions.ts";

type Deps = FamilyActionDependencies & Parameters<CommandBody>[1];
type SheetOwner = Record<(typeof SHEET_COMMANDS)[keyof typeof SHEET_COMMANDS], CommandExecutor>;
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
        const sheet = product.sheetWrites;
        if (!sheet) continue;
        if (!plan || !apply || sheets.has(sheet.route))
          throw Error(`Work route ${sheet.route} needs both sheet bodies from one product`);
        sheets.set(sheet.route, { [SHEET_COMMANDS.plan]: plan, [SHEET_COMMANDS.apply]: apply });
      }
      return { executors, sheets };
    },
  };
}
