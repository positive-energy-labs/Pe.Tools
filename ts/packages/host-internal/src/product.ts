import type { Effect } from "effect";
import type { DocumentRef, NativeProcess } from "@pe/agent-contracts";
import type {
  FileBody,
  HostBodies,
  HttpRequest,
  OwedBodies,
  ProductDeclaration,
} from "@pe/agent-contracts/product";
import type { AttemptHost } from "./action-execution.ts";
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
/** What a local operation's body answers with: the host's own services, and any failure. */
export type LocalRun = Effect.Effect<unknown, unknown, AttemptHost>;

/** The host half of a product: one body per declared reading, command, `http` route and local operation, or `tsc` fails. */
export function implement<P extends ProductDeclaration, D = Dependencies>(
  product: P,
  bodies: HostBodies<P, ReadContext, CommandBody<D>, D, LocalRun> &
    OwedBodies<P, HostBodies<P, ReadContext, CommandBody<D>, D, LocalRun>>,
): {
  product: P;
  reads: Record<string, Read<unknown, unknown>>;
  executors: (...args: Parameters<CommandBody<D>>) => Record<string, CommandExecutor>;
  http: Record<string, (request: HttpRequest, deps: D) => Promise<unknown>>;
  local: Record<string, (input: never, deps: D) => LocalRun>;
  files: Record<string, FileBody<D>>;
};
export function implement<D>(
  product: ProductDeclaration,
  bodies: HostBodies<ProductDeclaration, ReadContext, CommandBody<D>, D, LocalRun>,
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
    // A product that declares none passes none: `HostBodies` asks for a table only when a key exists.
    http: { ...bodies.http },
    local: { ...bodies.local },
    files: { ...bodies.files },
  };
}
