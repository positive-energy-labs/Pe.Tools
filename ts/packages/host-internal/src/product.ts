import type { DocumentRef, NativeProcess } from "@pe/agent-contracts";
import type { HostBodies, NoExtras, ProductDeclaration } from "@pe/agent-contracts/product";
import type { RevitBridge } from "./bridge.ts";
import type { CommandExecutor } from "./command-executor.ts";
import type { HostNativeRead } from "./native-read.ts";
import type { ReadContext } from "./reads/door.ts";

/** A command's host body. The command registry calls it once with the services it owns. */
export type CommandBody = (
  bridge: RevitBridge["Service"],
  deps: {
    nativeRead?: HostNativeRead["Service"];
    projectLifetime?: (target: DocumentRef) => Promise<NativeProcess>;
  },
) => CommandExecutor;
type Bodies<P extends ProductDeclaration> = HostBodies<P, ReadContext, CommandBody>;

/** The host half of a product: one body per declared reading and command, or `tsc` fails. */
export const implement = <
  P extends ProductDeclaration,
  R extends Bodies<P>["readings"],
  C extends Bodies<P>["commands"],
>(
  product: P,
  bodies: {
    readonly readings: R & NoExtras<R, Bodies<P>["readings"]>;
    readonly commands: C & NoExtras<C, Bodies<P>["commands"]>;
  },
) => ({ product, ...bodies });
