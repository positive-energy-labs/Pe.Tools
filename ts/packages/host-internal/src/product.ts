import type {
  DocumentRef,
  ModelRoom,
  NativeProcess,
  StagedRoomEdit,
  TakeoffCapture,
} from "@pe/agent-contracts";
import type {
  RhvacExtractData,
  RhvacInsertRoomData,
  RhvacSyncRequest,
  RhvacSyncResult,
} from "@pe/host-contracts/operation-types";
import type { Step } from "./action-execution.ts";
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
    /** Saved takeoff observations. A model write invalidates the document's retained one. */
    captures?: {
      invalidate(target: DocumentRef): void;
      saved(id: string): Promise<TakeoffCapture>;
      savedText(id: string): Promise<{ path: string; text: string }>;
    };
    /**
     * ponytail: the RHVAC file lane (sync-rhvac.ps1 and its temp files) lives in the host app, so
     * the host hands it in. Move the lane to a package when a second product writes an .r10.
     */
    rhvac?: {
      open(path: string): Step<RhvacExtractData>;
      sync(request: RhvacSyncRequest, expectedVersion: string): Step<RhvacSyncResult>;
      applyStaged<A extends Record<string, unknown>>(room: A, edit: StagedRoomEdit): A;
      buildInsert(room: ModelRoom, number: number, systemNumber: number): RhvacInsertRoomData;
    };
  },
) => CommandExecutor;

/** The host half of a product: one body per declared reading and command, or `tsc` fails. */
export function implement<P extends ProductDeclaration>(
  product: P,
  bodies: HostBodies<P, ReadContext, CommandBody>,
): {
  product: P;
  reads: Record<string, Read<unknown, unknown>>;
  executors: (...args: Parameters<CommandBody>) => Record<string, CommandExecutor>;
};
export function implement(
  product: ProductDeclaration,
  bodies: HostBodies<ProductDeclaration, ReadContext, CommandBody>,
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
    executors: (...args: Parameters<CommandBody>) =>
      Object.fromEntries(
        Object.entries(bodies.commands).map(([key, make]) => [key, make(...args)]),
      ),
  };
}
