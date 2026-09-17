import { FAMILY_MODEL_SCHEMA } from "#/route/family/manifest";
import { isSpecOf } from "#/route/manifest";
import { useMemo, type ComponentProps } from "react";
import { ActionReceipts } from "#/actions/receipt";
import { useRoute } from "#/route/use-route";
import { memberWorkManifest } from "#/route/spec-editor";
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
  const manifest = useMemo(() => memberWorkManifest(), []);
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
  const member = document?.basis?.member;
  // `$schema` is the only thing that says what a member is for.
  const isFamilyModel = declaresSchema(document?.basis?.rawContent, FAMILY_MODEL_SCHEMA);
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
          <Link className="ml-auto" to="/family" search={{ pod: member?.pod, path: member?.path }}>
            Open workspace
          </Link>
        ) : (
          <Link
            className="ml-auto"
            to="/pods"
            search={{ pod: member?.pod, path: member?.path }}
            title="The pods editor shows these proposals beside the member."
          >
            Open in pods
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

function declaresSchema(raw: string | undefined, schema: string) {
  try {
    return isSpecOf((JSON.parse(raw ?? "") as { $schema?: string }).$schema, schema);
  } catch {
    return false;
  }
}
