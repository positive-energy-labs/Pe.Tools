import type { DocumentRef, NativeProcess } from "@pe/agent-contracts";
import type { HostBodies, ProductDeclaration } from "@pe/agent-contracts/product";
import type { RevitBridge } from "./bridge.ts";
import type { CommandExecutor } from "./command-executor.ts";
import type { HostNativeRead } from "./native-read.ts";
import { body, type Read, type ReadContext } from "./reads/door.ts";

type Dependencies = {
  nativeRead?: HostNativeRead["Service"];
  projectLifetime?: (target: DocumentRef) => Promise<NativeProcess>;
};

/** A command's host body. The command registry calls it once with the services it owns. */
export type CommandBody<D = Dependencies> = (
  bridge: RevitBridge["Service"],
  deps: D,
) => CommandExecutor;

/** The host half of a product: one body per declared reading and command, or `tsc` fails. */
export function implement<P extends ProductDeclaration, D = Dependencies>(
  product: P,
  bodies: HostBodies<P, ReadContext, CommandBody<D>>,
): {
  product: P;
  reads: Record<string, Read<unknown, unknown>>;
  executors: (...args: Parameters<CommandBody<D>>) => Record<string, CommandExecutor>;
};
export function implement<D>(
  product: ProductDeclaration,
  bodies: HostBodies<ProductDeclaration, ReadContext, CommandBody<D>>,
) {
  const reads = Object.fromEntries(
    Object.entries(product.readings).map(([key, { handle }]) => {
      const run = bodies.readings[key];
      if (!run) throw Error(`No host body for ${handle.key}`);
      if (typeof run === "function") return [key, body(handle, run)];
      if (run.contract && (run.contract !== handle || run.name !== handle.key))
        throw Error(`Wrong host body for ${handle.key}`);
      return [key, run.contract ? run : body(handle, run.run)];
    }),
  );
  return {
    product,
    reads,
    executors: (...args: Parameters<CommandBody<D>>) =>
      Object.fromEntries(
        Object.entries(bodies.commands).map(([key, make]) => [key, make(...args)]),
      ),
  };
}
