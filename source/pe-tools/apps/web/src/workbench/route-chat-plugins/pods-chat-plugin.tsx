import { actionLabel, parseRouteDoc, podsRouteState, type PodsDocument } from "@pe/agent-contracts";
import { Link } from "@tanstack/react-router";

import { InlineRoutePlugin, Metric } from "./parameter-links-review";
import type { RouteChatPluginProps } from "./tool-names";

/**
 * The Pods card: where the user watches pea build the thing they will press in Revit. The target
 * line renders the session and document the last receipt actually ran against, never a typed
 * selector; the Scope head above the thread is the user's control over the next one.
 */
export function PodsChatPlugin({
  toolName,
  args,
  sessionState,
  running,
  revision,
}: RouteChatPluginProps) {
  const doc: PodsDocument | null = parseRouteDoc(sessionState, podsRouteState);
  const receipt = doc?.receipt;
  return (
    <InlineRoutePlugin
      title={podsRouteState.title}
      action={actionLabel(toolName, args, running)}
      revision={revision}
    >
      <span className="flex items-baseline gap-2">
        <span>{receipt?.target.session ?? "no run yet"}</span>
        <span className="truncate">{receipt?.target.document ?? ""}</span>
      </span>
      <Metric value={podCount(doc?.pods?.value)} label="pods" />
      <span>
        {receipt
          ? `${receipt.command}${receipt.entrypoint ? ` · ${receipt.entrypoint}` : ""}`
          : "no run yet"}
      </span>
      <Link className="ml-auto" to="/chat" search={(previous) => ({ ...previous, plugin: "pods" })}>
        Open workspace
      </Link>
    </InlineRoutePlugin>
  );
}

/** The refresh payload is the host's own pod-list shape; count whatever array it carries. */
function podCount(pods: unknown): number {
  if (pods && typeof pods === "object" && Array.isArray((pods as { pods?: unknown }).pods))
    return (pods as { pods: unknown[] }).pods.length;
  return 0;
}
