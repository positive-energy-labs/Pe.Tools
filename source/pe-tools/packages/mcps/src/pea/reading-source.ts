import type { ReadingFrom } from "@pe/agent-contracts";

import type { HostRpcCaller } from "../shared/host-rpc-caller.ts";

export async function currentReadingIdentity(
  rpc: HostRpcCaller,
  documentId?: string,
): Promise<Pick<ReadingFrom, "target" | "documentId">> {
  const session = await rpc.call("bridge.sessions.summary");
  const target =
    session.sdkSessionId ?? (session.processId == null ? null : `pid:${session.processId}`);
  const currentDocumentId =
    documentId ?? session.activeDocument?.cloudModelGuid ?? session.activeDocument?.path;
  if (!target) throw new Error("The bound Revit world has no sdkSessionId or pid.");
  if (!currentDocumentId)
    throw new Error("The bound Revit document has no cloud model GUID or absolute path.");
  return { target, documentId: currentDocumentId };
}
