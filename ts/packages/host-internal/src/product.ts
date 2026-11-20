import type { DocumentRef, NativeProcess } from "@pe/agent-contracts";
import type { HostBodies, ProductDeclaration } from "@pe/agent-contracts/product";
import type { RevitBridge } from "./bridge.ts";
import type { CommandExecutor } from "./command-executor.ts";
import type { HostNativeRead } from "./native-read.ts";
import { body, type Read, type ReadContext } from "./reads/door.ts";

/** A command's host body. The command registry calls it once with the services it owns. */
export type CommandBody = (
  bridge: RevitBridge["Service"],
  deps: {
    nativeRead?: HostNativeRead["Service"];
    projectLifetime?: (target: DocumentRef) => Promise<NativeProcess>;
  },
) => CommandExecutor;

/**
 * The host half of a product: one body per declared reading and command, or `tsc` fails. Each
 * reading body is registered under its handle, so `reads` is what a route's host module exports.
 */
export const implement = <P extends ProductDeclaration>(
  product: P,
  bodies: HostBodies<P, ReadContext, CommandBody>,
) => ({
  product,
  ...bodies,
  reads: Object.fromEntries(
    Object.entries(product.readings).map(([name, reading]) => [
      name,
      // Type erasure occurs here: `HostBodies` already tied each body to its handle's input and data.
      body(reading.handle, (bodies.readings as Record<string, Read<unknown, unknown>["run"]>)[name]!),
    ]),
  ) as { readonly [K in keyof P["readings"]]: Read<unknown, unknown> },
});
