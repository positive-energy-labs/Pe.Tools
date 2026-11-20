import type { DocumentRef, NativeProcess } from "@pe/agent-contracts";
import type { HomeBodies, HostBodies, ProductDeclaration } from "@pe/agent-contracts/product";
import type { RevitBridge } from "./bridge.ts";
import type { CommandExecutor } from "./command-executor.ts";
import { declareHome, type HomeReader } from "./home-files.ts";
import { declareRetained } from "./retained-readings.ts";
import type { HostNativeRead } from "./native-read.ts";
import { body, type Read, type ReadContext } from "./reads/door.ts";

type Dependencies = {
  nativeRead?: HostNativeRead["Service"];
  projectLifetime?: (target: DocumentRef) => Promise<NativeProcess>;
};

const hasHomes = (
  bodies: object,
): bodies is { readonly homes: Readonly<Record<string, HomeReader | undefined>> } =>
  "homes" in bodies;

/** A command's host body. The command registry calls it once with the services it owns. */
export type CommandBody<D = Dependencies> = (
  bridge: RevitBridge["Service"],
  deps: D,
) => CommandExecutor;

/**
 * The host half of a product: one body per declared reading and command, and one reader per home
 * only the product can read, or `tsc` fails. Its retained readings are the kernel's from here.
 */
export function implement<P extends ProductDeclaration, D = Dependencies>(
  product: P,
  bodies: HostBodies<P, ReadContext, CommandBody<D>> & HomeBodies<P, HomeReader>,
): {
  product: P;
  reads: Record<string, Read<unknown, unknown>>;
  executors: (...args: Parameters<CommandBody<D>>) => Record<string, CommandExecutor>;
};
export function implement<D>(
  product: ProductDeclaration,
  // The overload decides whether `homes` is owed; `tsc` cannot relate that condition to an erased
  // declaration, so the readers are read back by name here.
  bodies: HostBodies<ProductDeclaration, ReadContext, CommandBody<D>>,
) {
  for (const [key, home] of Object.entries(product.homes)) {
    if (home.read !== "product") continue;
    const reader = hasHomes(bodies) ? bodies.homes[key] : undefined;
    if (!reader) throw Error(`No host reader for home ${key}`);
    const place = home.place(key);
    declareHome(key, { ...reader, directory: place.at === "setting" ? place.owner : key });
  }
  declareRetained(product);
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
