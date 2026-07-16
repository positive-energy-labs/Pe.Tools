import { Link } from "@tanstack/react-router";

import { familyRouteState, readRouteState, settingsRouteState } from "@pe/agent-contracts";

import {
  InlineRoutePlugin,
  Metric,
  type RouteChatPluginProps,
  actionLabel,
} from "../route-chat-plugins";

/** Inline chat card for route:family commands (parse_spec / capture / build).
 * Authored-field review renders through the settings plugin; this card carries the
 * sibling context — spec doc size and evidence provenance/freshness. */
export function FamilyChatPlugin({ toolName, args, sessionState, running }: RouteChatPluginProps) {
  const document = readRouteState(sessionState, familyRouteState);
  const settings = readRouteState(sessionState, settingsRouteState);
  const evidence = document?.evidence ?? null;
  const evidenceFresh =
    evidence != null &&
    (evidence.from.documentVersionToken == null ||
      evidence.from.documentVersionToken === settings?.snapshot?.versionToken);

  return (
    <InlineRoutePlugin title="Family" action={actionLabel(toolName, args, running)}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Metric value={document?.doc?.blocks.length ?? 0} label="doc blocks" />
        <Metric value={document?.doc?.images?.length ?? 0} label="doc images" />
        {evidence ? (
          <span
            className={`text-xs ${evidenceFresh ? "text-[var(--lichen)]" : "text-[var(--kiln)]"}`}
            title={`Evidence from ${evidence.from.origin} of ${evidence.from.familyName} at ${evidence.from.capturedAt}`}
          >
            evidence · {evidence.from.origin} · {evidenceFresh ? "fresh" : "stale"}
          </span>
        ) : (
          <span className="text-xs text-[var(--slate)]">no evidence yet</span>
        )}
        <Link className="ml-auto font-medium text-[var(--pe-blue)] hover:underline" to="/family">
          Open workspace
        </Link>
      </div>
    </InlineRoutePlugin>
  );
}
