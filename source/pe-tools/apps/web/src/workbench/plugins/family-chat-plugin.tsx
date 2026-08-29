import { Link } from "@tanstack/react-router";

import { familyRouteState, parseRouteDoc } from "@pe/agent-contracts";

import {
  InlineRoutePlugin,
  Metric,
  type RouteChatPluginProps,
  actionLabel,
} from "../route-chat-plugins";

export function FamilyChatPlugin({ toolName, args, sessionState, running }: RouteChatPluginProps) {
  const document = parseRouteDoc(sessionState, familyRouteState);
  const evidence = document?.evidence ?? null;

  return (
    <InlineRoutePlugin title={familyRouteState.title} action={actionLabel(toolName, args, running)}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Metric value={document?.doc?.blocks.length ?? 0} label="doc blocks" />
        <Metric value={document?.doc?.images?.length ?? 0} label="doc images" />
        {evidence ? (
          <span
            className=""
            title={`Evidence from ${evidence.origin} of ${evidence.familyName} at ${evidence.reading.observedAt}`}
          >
            evidence · {evidence.origin}
          </span>
        ) : (
          <span className="">no evidence yet</span>
        )}
        <Link className="ml-auto" to="/family">
          Open workspace
        </Link>
      </div>
    </InlineRoutePlugin>
  );
}
