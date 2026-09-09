import type { Scope } from "@pe/agent-contracts";
import type { useFleet } from "#/host/fleet";
import { documentSession, sessionKey, type SessionFacts } from "#/host/target";

export type RouteTarget =
  | { kind: "ready"; session: SessionFacts }
  | { kind: "pick" | "checking" | "unavailable" | "gone"; reason: string };

/** Losing a bridge is not evidence that its Revit process ended. */
export function routeTarget(
  scope: Scope | undefined,
  fleet: ReturnType<typeof useFleet>,
): RouteTarget {
  if (!scope || scope.kind !== "document" || !scope.pin)
    return { kind: "pick", reason: "Pick a session and document." };
  if (fleet.error) return { kind: "unavailable", reason: fleet.error.message };
  if (
    fleet.stale ||
    fleet.isLoading ||
    fleet.processReadErrors.length ||
    fleet.unreadableReceipts.length
  )
    return {
      kind: "checking",
      reason: "Checking the requested session; its document is kept for recovery.",
    };
  const selected = fleet.worlds.find(
    (world) =>
      world.id === scope.pin ||
      world.brokerSessionId === scope.pin ||
      world.session?.sessionId === scope.pin ||
      (world.session && sessionKey(world.session) === scope.pin),
  );
  if (selected?.phase === "gone")
    return {
      kind: "gone",
      reason: "The selected session ended. Pick a session to recover this document.",
    };
  const session = documentSession(scope, fleet.sessions);
  if (session) return { kind: "ready", session };
  if (selected && !selected.session?.openDocuments)
    return { kind: "checking", reason: "Waiting for the selected session's document inventory." };
  if (!selected)
    return {
      kind: "gone",
      reason: "The selected session ended. Pick a session to recover this document.",
    };
  return {
    kind: "pick",
    reason: "The requested document is not open in this session. Select or reopen it below.",
  };
}
