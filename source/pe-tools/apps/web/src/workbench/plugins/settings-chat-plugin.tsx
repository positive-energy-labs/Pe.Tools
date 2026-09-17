import { useMemo, type ComponentProps } from "react";
import { ActionReceipts } from "#/actions/receipt";
import { useRoute } from "#/route/use-route";
import { settingsManifest } from "#/settings/manifest";
import { Link } from "@tanstack/react-router";

import { cellSummary, settingsRouteState } from "@pe/agent-contracts";
import { recordedRouteDoc } from "#/workbench/route-chat-plugins/tool-names";

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
    <Link to="/pods">Open pods</Link>
  );
}

function FileSettingsChatPlugin(props: RouteChatPluginProps & { workspaceId: string }) {
  const scope = useMemo(
    () => ({ route: settingsRouteState.route, target: null, work: props.workspaceId }),
    [props.workspaceId],
  );
  const manifest = useMemo(() => settingsManifest({ scope }), [scope]);
  const route = useRoute(manifest, { work: props.workspaceId });
  if (!route.work.current || !route.work.doc) return null;
  return (
    <>
      <SettingsReview
        {...props}
        sessionState={route.work.doc}
        state={{
          apply: route.work.write,
          busy: route.busy?.key ?? null,
          failure: route.failure,
        }}
        onCommit={() => route.actions.save.run()}
      />
      <ActionReceipts
        key={`${props.workspaceId}:${route.outcome?.at ?? 0}`}
        scope={{ kind: "file", workspaceId: props.workspaceId }}
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
  state,
  onCommit,
}: RouteChatPluginProps & {
  state: ComponentProps<typeof CellTrichotomyReviewer>["state"];
  onCommit: () => Promise<unknown>;
}) {
  const document = recordedRouteDoc(sessionState, settingsRouteState);
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
        {isFamilyModel ? (
          <Link
            className="ml-auto"
            to="/family"
            search={{
              mode: "file",
              module: document?.basis?.documentId.moduleKey,
              root: document?.basis?.documentId.rootKey,
              file: document?.basis?.documentId.relativePath,
            }}
          >
            Open workspace
          </Link>
        ) : (
          <Link className="ml-auto" to="/pods">
            Open pods
          </Link>
        )}
      </div>

      {active && reviewable ? (
        <CellTrichotomyReviewer
          state={state}
          segment="fields"
          cells={fields}
          onCommit={onCommit}
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
