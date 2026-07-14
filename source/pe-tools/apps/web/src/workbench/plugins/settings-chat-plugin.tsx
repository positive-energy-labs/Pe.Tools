import { Link } from "@tanstack/react-router";

import { cellSummary, readRouteState, settingsRouteState } from "@pe/agent-contracts";

import {
  InlineRoutePlugin,
  Metric,
  type RouteChatPluginProps,
  actionLabel,
} from "../route-chat-plugins";
import { CellTrichotomyReviewer } from "../trichotomy-reviewer";

/** Inline chat card + reviewer for the /settings route (mirrors FamilyTypesChatPlugin). */
export function SettingsChatPlugin({
  toolName,
  args,
  sessionState,
  running,
  active,
}: RouteChatPluginProps) {
  const document = readRouteState(sessionState, settingsRouteState);
  const fields = document?.fields ?? {};
  const summary = cellSummary(fields);
  const openProposals = Object.values(fields).filter(
    (field) => field.proposal != null && field.staged == null,
  ).length;
  const reviewable = Object.values(fields).some(
    (field) => field.proposal != null || field.staged != null,
  );

  if (active && !reviewable) return null;

  return (
    <InlineRoutePlugin title="Settings" action={actionLabel(toolName, args, running)}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Metric value={openProposals} label="open proposals" />
        <Metric value={summary.staged} label="staged" />
        <Metric value={summary.attention} label="need attention" issue />
        <Link
          className="ml-auto font-medium text-[var(--pe-blue)] hover:underline"
          to="/chat"
          search={(previous) => ({ ...previous, plugin: "settings" })}
        >
          Open workspace
        </Link>
      </div>

      {active && reviewable ? (
        <CellTrichotomyReviewer
          route="settings"
          segment="fields"
          cells={fields}
          commitCommand="save"
          commitLabel={(staged) => `Save ${staged}`}
          reviewHint="Pea can propose; only you can save."
          renderLabel={(path) => <span className="font-mono">{path}</span>}
          renderValue={displaySettingsValue}
        />
      ) : null}
    </InlineRoutePlugin>
  );
}

function displaySettingsValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
