import { Link } from "@tanstack/react-router";

import { cellSummary, parseRouteDoc, settingsRouteState } from "@pe/agent-contracts";

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
  routeState,
}: RouteChatPluginProps) {
  const document = parseRouteDoc(sessionState, settingsRouteState);
  const isFamilyModel =
    document?.snapshot?.from.settingsDocumentId.moduleKey === "FamilyFoundry" &&
    document.snapshot.from.settingsDocumentId.rootKey === "models";
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
    <InlineRoutePlugin
      title={isFamilyModel ? "Family Model" : settingsRouteState.title}
      action={actionLabel(toolName, args, running)}
    >
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Metric value={openProposals} label="open proposals" />
        <Metric value={summary.staged} label="staged" />
        <Metric value={summary.attention} label="need attention" issue />
        <Link
          className="ml-auto text-[var(--r-nav)] hover:underline"
          to={isFamilyModel ? "/family" : "/chat"}
          search={isFamilyModel ? undefined : (previous) => ({ ...previous, plugin: "settings" })}
        >
          Open workspace
        </Link>
      </div>

      {active && reviewable ? (
        <CellTrichotomyReviewer
          state={routeState}
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
