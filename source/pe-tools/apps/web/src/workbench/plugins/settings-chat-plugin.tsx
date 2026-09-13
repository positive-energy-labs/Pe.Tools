import { useState } from "react";
import {
  saveSettingsAction,
  actionResult,
} from "../../../../../packages/mcps/src/shared/takeoff-action-client";
import { ActionReceipts } from "#/actions/receipt";
import { useRouteState } from "../route-state";
import { Link } from "@tanstack/react-router";

import { cellSummary, parseRouteDoc, settingsRouteState } from "@pe/agent-contracts";

import {
  InlineRoutePlugin,
  Metric,
  type RouteChatPluginProps,
  actionLabel,
} from "../route-chat-plugins";
import { CellTrichotomyReviewer } from "../trichotomy-reviewer";

export function SettingsChatPlugin(props: RouteChatPluginProps) {
  const args =
    props.args && typeof props.args === "object" ? (props.args as Record<string, unknown>) : {};
  const workspaceId = typeof args.workspaceId === "string" ? args.workspaceId : null;
  return workspaceId ? (
    <FileSettingsChatPlugin key={workspaceId} {...props} workspaceId={workspaceId} />
  ) : (
    <Link to="/settings" search={{ mode: "file" }}>
      Open file Work
    </Link>
  );
}

function FileSettingsChatPlugin(props: RouteChatPluginProps & { workspaceId: string }) {
  const work = { route: settingsRouteState.route, target: null, work: props.workspaceId };
  const state = useRouteState(settingsRouteState, work);
  const [actionId, setActionId] = useState<string | null>(null);
  const commands = {
    ...state,
    command: async (command: string, input?: unknown, receipt?: string, revision?: number) => {
      if (command !== "save") return state.command(command, input, receipt, revision);
      if (!state.slice || revision == null) throw Error("Review the file Work before saving");
      const row = await saveSettingsAction(work, state.slice, revision);
      setActionId(row.id);
      return { ok: true as const, revision, result: actionResult(row) };
    },
  };
  return (
    <>
      <SettingsReview {...props} sessionState={state.slice} routeState={commands} />
      <ActionReceipts
        key={props.workspaceId}
        scope={{ kind: "file", workspaceId: props.workspaceId }}
        lastId={actionId}
      />
    </>
  );
}

function SettingsReview({
  toolName,
  args,
  sessionState,
  running,
  active,
  routeState,
}: RouteChatPluginProps) {
  const document = parseRouteDoc(sessionState, settingsRouteState);
  const isFamilyModel =
    document?.basis?.documentId.moduleKey === "FamilyFoundry" &&
    document.basis?.documentId.rootKey === "models";
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
        <Link
          className="ml-auto"
          to={isFamilyModel ? "/family" : "/settings"}
          search={{
            mode: "file",
            module: document?.basis?.documentId.moduleKey,
            root: document?.basis?.documentId.rootKey,
            file: document?.basis?.documentId.relativePath,
          }}
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
          commitInput={{ versionToken: document?.basis?.versionToken }}
          commitLabel={(staged) => `Save ${staged}`}
          reviewHint="Pea can propose; only you can save."
          renderLabel={(path) => <span className="">{path}</span>}
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
