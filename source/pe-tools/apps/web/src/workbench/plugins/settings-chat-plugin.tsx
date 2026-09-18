import { FAMILY_MODEL_SCHEMA } from "#/route/family/manifest";
import { isSpecOf } from "#/route/manifest";
import { useMemo } from "react";
import { ActionReceipts } from "#/actions/receipt";
import { useRoute } from "#/route/use-route";
import { memberWorkManifest } from "#/route/spec-editor";
import { Link } from "@tanstack/react-router";

import { cellSummary, settingsRouteState, type RouteStatePatch } from "@pe/agent-contracts";
import { recordedRouteDoc } from "#/workbench/route-chat-plugins/tool-names";

import {
  InlineRoutePlugin,
  Metric,
  type RouteChatPluginProps,
  actionLabel,
} from "../route-chat-plugins";
import {
  reviewAddresses,
  reviewCommit,
  reviewPatches,
  ReviewRow,
  WorkBand,
} from "#/components/lang/band";

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
        work={route.work}
        busy={route.busy != null}
        failure={route.failure}
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
  work,
  busy,
  failure,
  onCommit,
}: RouteChatPluginProps & {
  work: {
    revision: number | null;
    write: (patches: RouteStatePatch[]) => Promise<unknown>;
    conflict: boolean;
    reload: () => void;
  };
  busy: boolean;
  failure: { message: string } | null;
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
  const items = reviewAddresses(fields);
  const reviewable = items.length > 0;
  const staged = items.filter(([, field]) => field.staged != null);
  const patch = reviewPatches("fields");
  const run = (patches: RouteStatePatch[]) => void work.write(patches).catch(() => undefined);

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
        <WorkBand
          count={staged.length}
          noun="field"
          revision={work.revision}
          conflict={work.conflict}
          reload={work.reload}
          busy={busy}
          visible
          discard={() => run(staged.flatMap(([path]) => patch.unstage(path)))}
          commit={reviewCommit(
            `Save ${staged.length}`,
            staged.length,
            () => void onCommit().catch(() => undefined),
          )}
          unresolved={failure ? [failure.message] : []}
          body={items.map(([path, field]) => (
            <ReviewRow
              key={path}
              address={path}
              label={path}
              cell={field}
              facts={{ value: displaySettingsValue(field.staged ?? field.proposal) }}
              busy={busy}
              onAccept={(address) => run(patch.accept(address, field))}
              onDeny={(address) => run(patch.deny(address))}
              onUnstage={(address) => run(patch.unstage(address))}
            />
          ))}
        />
      ) : null}
    </InlineRoutePlugin>
  );
}

function displaySettingsValue(rung: { value?: unknown; delete?: true } | null | undefined) {
  if (rung?.delete) return "DELETE";
  if (rung?.value === undefined) return "—";
  return typeof rung.value === "string" ? rung.value : JSON.stringify(rung.value);
}

function declaresSchema(raw: string | undefined, schema: string) {
  try {
    return isSpecOf((JSON.parse(raw ?? "") as { $schema?: string }).$schema, schema);
  } catch {
    return false;
  }
}
