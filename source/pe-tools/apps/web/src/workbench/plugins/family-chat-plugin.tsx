import { Link } from "@tanstack/react-router";

import { familyRouteState, parseRouteDoc, settingsRouteState } from "@pe/agent-contracts";

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
  const document = parseRouteDoc(sessionState, familyRouteState);
  const settings = parseRouteDoc(sessionState, settingsRouteState);
  const evidence = document?.evidence ?? null;
  const evidenceFresh =
    evidence != null &&
    (evidence.from.documentVersionToken == null ||
      evidence.from.documentVersionToken === settings?.snapshot?.from.documentVersionToken);

  return (
    <InlineRoutePlugin title={familyRouteState.title} action={actionLabel(toolName, args, running)}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Metric value={document?.doc?.blocks.length ?? 0} label="doc blocks" />
        <Metric value={document?.doc?.images?.length ?? 0} label="doc images" />
        {/* freshness rides the squiggle family's colours: fresh → done, stale → caution */}
        {evidence ? (
          <span
            className={`t-label face-mono ${
              evidenceFresh ? "text-[var(--r-done)]" : "text-[var(--r-caution)]"
            }`}
            title={`Evidence from ${evidence.from.origin} of ${evidence.from.familyName} at ${evidence.from.observedAt}`}
          >
            evidence · {evidence.from.origin} · {evidenceFresh ? "fresh" : "stale"}
          </span>
        ) : (
          <span className="t-label text-[var(--r-ink-mute)]">no evidence yet</span>
        )}
        <Link className="ml-auto text-[var(--r-nav)] hover:underline" to="/family">
          Open workspace
        </Link>
      </div>
    </InlineRoutePlugin>
  );
}
