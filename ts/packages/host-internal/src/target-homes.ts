import { Effect } from "effect";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import type { RevitBridge } from "./bridge.ts";

/**
 * The home list a call reads (ADR 0037): the pointer of the document the call targets, as the
 * bridge's open-document snapshot reports it. A call that targets no open document has no project
 * home, and a targeted document with no pointer is `null`.
 */
export const targetHomes = Effect.fnUntraced(function* (
  bridge: Pick<RevitBridge["Service"], "list">,
  scope: HostSessionScope | undefined,
) {
  if (!scope?.openDocumentId) return {};
  const target = (yield* bridge.list)
    .filter((session) => !scope.bridgeSessionId || session.sessionId === scope.bridgeSessionId)
    .flatMap((session) => session.state?.openDocuments ?? [])
    .find((document) => document.openId === scope.openDocumentId);
  return target ? { pointer: target.projectHome } : {};
});
