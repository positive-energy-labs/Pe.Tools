import { z } from "zod";
import { type ReadEntry } from "@pe/agent-contracts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import {
  isAnyOperationKey,
  tsOnlyOperationCatalog,
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { callOp } from "#/shell/readings-api";

export const podRequest = z.object({ key: z.string(), input: z.record(z.string(), z.unknown()) });
export function podOperation(key: string) {
  if (!isAnyOperationKey(key)) throw Error(`Unknown operation ${key}`);
  const op =
    tsOnlyOperationCatalog.find((op) => op.key === key) ??
    hostOpCatalog.find((op) => op.key === key);
  const intent = op?.intent?.toLowerCase();
  if (!op || (intent !== "read" && intent !== "mutate"))
    throw Error(`Operation readiness metadata is unavailable for ${key}`);
  return { ...op, intent };
}
export const podRead: ReadEntry<typeof podRequest> = {
  key: "pod.read",
  input: podRequest,
  async run({ key, input }, { target }) {
    if (!key.startsWith("pod.") && podOperation(key).intent.toLowerCase() !== "read")
      throw Error("Mutations require action admission");
    if (target.kind !== "document") throw Error("Choose an exact document");
    if (!isAnyOperationKey(key)) throw Error(`Unknown operation ${key}`);
    return callOp(
      {
        signal: AbortSignal.timeout(120_000),
        headers: {
          [HOST_RPC_BRIDGE_SESSION_HEADER]: target.ref.session,
          [HOST_RPC_DOCUMENT_HEADER]: target.ref.openId,
        },
      },
      key,
      input,
    );
  },
};
