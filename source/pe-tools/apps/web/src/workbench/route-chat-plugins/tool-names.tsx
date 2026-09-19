import { actionReceiptId } from "./receipt-id";
export { actionReceiptId };
import {
  takeoffsRouteState,
  semanticActions,
  familyReads,
  actionControls,
} from "@pe/agent-contracts";
import { ActionReceiptView } from "#/actions/receipt";
import { previousOf } from "#/readings";
import { instancesRouteState, stagedParameterLinks } from "@pe/agent-contracts";
import type { ComponentType } from "react";
import type { z } from "zod";
import {
  actionLabel,
  familyCaptureSchema,
  parameterLinksReadingSchema,
  routeCallOf,
  parameterLinksRouteState,
  parseRouteDoc,
  scheduleReads,
  scheduleGridRouteState,
  settingsRouteState,
  type RouteStateSpec,
} from "@pe/agent-contracts";
import { Link } from "@tanstack/react-router";
import { useWorkbench } from "../provider";
import { selectToolCalls } from "../chat-state";
import { useRoute } from "#/route/use-route";
import { manifest as parameterLinksManifest } from "#/parameter-links/manifest";
import { FamilyChatPlugin } from "../plugins/family-chat-plugin";
import { ScheduleGridChatPlugin } from "../plugins/schedule-grid-chat-plugin";
import { SettingsChatPlugin } from "../plugins/settings-chat-plugin";
import { useThreadScope } from "#/chat/scope";
import { evaluationIsCurrent } from "#/parameter-links/model";
import {
  InlineRoutePlugin,
  Metric,
  ParameterLinksReview,
  isRecord,
} from "./parameter-links-review";

export interface RouteChatPluginProps {
  toolCallId: string;
  toolName: string;
  args: unknown;
  sessionState: unknown;
  running: boolean;
  active: boolean;
  /** The Target this call recorded, or null when the recorded result names none. Never the live
   * thread target: a transcript card is an audit record of the turn that produced it. */
  target: string | null;
  /** The revision the recorded result ran under; null when the result records none. */
  revision: number | null;
}

export type RouteChatPluginViewProps = Omit<RouteChatPluginProps, "active" | "revision" | "target">;

export interface RouteChatPluginRegistration {
  spec: RouteStateSpec<z.ZodType>;
  Renderer: ComponentType<RouteChatPluginProps>;
  /** The live workspace strip for the dock, where reading current Work is the point. Cards never
   * use it. */
  Live?: ComponentType<RouteChatPluginProps>;
}

/** What the turn recorded about where it ran: `{ target: { session, document }, revision }` as
 * written by the pea tools (`packages/mcps/src/pea/capability-tools.ts`). A card reads only this. */
export function recordedTarget(sessionState: unknown): {
  target: string | null;
  revision: number | null;
} {
  const outer =
    isRecord(sessionState) && isRecord(sessionState.structuredContent)
      ? sessionState.structuredContent
      : sessionState;
  const record = isRecord(outer) ? outer : undefined;
  const target = isRecord(record?.target) ? record.target : undefined;
  return {
    target: typeof target?.document === "string" ? target.document : null,
    revision: typeof record?.revision === "number" ? record.revision : null,
  };
}

/** The route document the call recorded (route-state outcome: `{ ok, revision, doc }`). */
export function recordedRouteDoc<TSchema extends z.ZodType>(
  sessionState: unknown,
  spec: RouteStateSpec<TSchema>,
): z.infer<TSchema> | null {
  const outer =
    isRecord(sessionState) && isRecord(sessionState.structuredContent)
      ? sessionState.structuredContent
      : sessionState;
  const inner = isRecord(outer) && isRecord(outer.result) ? outer.result : outer;
  return parseRouteDoc(isRecord(inner) ? inner.doc : null, spec);
}

export const routeChatPluginList: RouteChatPluginRegistration[] = [
  { spec: takeoffsRouteState, Renderer: TakeoffsChatPlugin },
  { spec: instancesRouteState, Renderer: InstancesChatPlugin },
  {
    spec: parameterLinksRouteState,
    Renderer: ParameterLinksChatPlugin,
    Live: ParameterLinksLivePlugin,
  },
  {
    spec: settingsRouteState,
    Renderer: SettingsChatPlugin,
  },
  {
    spec: scheduleGridRouteState,
    Renderer: ScheduleGridChatPlugin,
  },
];

export const routeChatPlugins = Object.fromEntries(
  routeChatPluginList.map((registration) => [registration.spec.route, registration]),
) as Record<string, RouteChatPluginRegistration>;

export const CHAT_PLUGIN_ROUTES = [
  "instances",
  "takeoffs",
  "family",
  "families",
  "pods",
  "parameter-links",
  "schedules",
] as const;

export type ChatPluginRoute = (typeof CHAT_PLUGIN_ROUTES)[number];

export function chatPluginTitle(route: string): string {
  return (
    routeChatPlugins[route]?.spec.title ??
    (route === "family" ? "Family" : route === "families" ? "Families" : route)
  );
}

/** An action key's first segment names its entity; a few entities live on a differently named route. */
const keyRoute = (entity: string) =>
  ({ schedule: "schedules", settings: "pods", pod: "pods" })[entity] ?? entity;

export function selectRouteChatPlugin(
  toolName: string,
  args: unknown,
): RouteChatPluginRegistration | null {
  if (
    (toolName === "pe_do" || toolName === "pe_read") &&
    isRecord(args) &&
    typeof args.key === "string" &&
    /^(op|workflow):/.test(args.key) &&
    (Object.hasOwn(semanticActions, args.key.replace(/^(op|workflow):/, "")) ||
      Object.hasOwn(familyReads, args.key.replace(/^(op|workflow):/, "")) ||
      Object.hasOwn(scheduleReads, args.key.replace(/^(op|workflow):/, "")) ||
      Object.hasOwn(actionControls, args.key.replace(/^(op|workflow):/, "")))
  )
    return (
      routeChatPlugins[keyRoute(args.key.replace(/^(op|workflow):/, "").split(".")[0]!)] ??
      routeChatPlugins.takeoffs
    );
  const call = routeCallOf(toolName, args);
  return call ? (routeChatPlugins[call.route] ?? null) : null;
}

export function RouteChatPluginView(props: RouteChatPluginViewProps) {
  const registration = selectRouteChatPlugin(props.toolName, props.args);
  const key =
    isRecord(props.args) && typeof props.args.key === "string"
      ? props.args.key.replace(/^(op|workflow):/, "")
      : "";

  if (Object.hasOwn(familyReads, key)) return <FamilyChatPlugin {...props} />;

  if (
    Object.hasOwn(semanticActions, key) ||
    Object.hasOwn(actionControls, key) ||
    registration?.spec.route === "takeoffs"
  )
    return <TakeoffsReceiptPlugin {...props} />;
  const id = actionReceiptId(props.args, props.sessionState);
  if (
    id &&
    isRecord(props.args) &&
    typeof props.args.key === "string" &&
    /^(op|pod):/.test(props.args.key)
  )
    return (
      <InlineRoutePlugin title="Operation" action="original operation receipt">
        <ActionReceiptView id={id} />
        <Link to="/ops" search={{ actionId: id }}>
          Open operation receipt
        </Link>
      </InlineRoutePlugin>
    );

  return registration ? (
    <ConnectedRouteChatPlugin registration={registration} {...props} active={false} />
  ) : null;
}

export function RouteChatPluginDock() {
  const { chat, isRunning } = useWorkbench();
  const registrations = Array.from(
    new Set(
      selectToolCalls(chat).flatMap((call) => {
        const route = selectRouteChatPlugin(call.title, call.args)?.spec.route;
        return route && route !== "takeoffs" && route !== "family" && routeChatPlugins[route]
          ? [route]
          : [];
      }),
    ),
  ).map((route) => routeChatPlugins[route]);

  if (isRunning || registrations.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {registrations.map((registration) => (
        <LiveRouteChatPlugin
          key={registration.spec.route}
          registration={registration}
          toolCallId={`${registration.spec.route}-review-dock`}
          toolName="pe_do"
          args={{ key: `route:${registration.spec.route}.review` }}
          sessionState={{}}
          running={false}
          active
        />
      ))}
    </div>
  );
}

/** A transcript card. Its Target and revision are the ones the call recorded; the live thread
 * scope is deliberately not read here, because a receipt that moves is not a receipt. */
export function ConnectedRouteChatPlugin({
  registration,
  ...props
}: RouteChatPluginViewProps & { active: boolean; registration: RouteChatPluginRegistration }) {
  const Renderer = registration.Renderer;
  const recorded = recordedTarget(props.sessionState);
  return <Renderer {...props} target={recorded.target} revision={recorded.revision} />;
}

/** The dock's live workspace strip: here the current thread scope *is* the subject. */
function LiveRouteChatPlugin({
  registration,
  ...props
}: RouteChatPluginViewProps & { active: boolean; registration: RouteChatPluginRegistration }) {
  const { currentThreadId } = useWorkbench();
  const threadScope = useThreadScope(currentThreadId);
  if (!threadScope.hydrated) return null;
  const Renderer = registration.Live ?? registration.Renderer;
  return (
    <Renderer
      {...props}
      target={
        threadScope.defaultTarget?.kind === "named" ? threadScope.defaultTarget.address : null
      }
      revision={threadScope.revision}
    />
  );
}

/** The Parameter Links card: authored draft as recorded, and nothing the turn did not record.
 * Evaluation (projected writes, issues) lives in host readings, which the result does not carry. */
export function ParameterLinksChatPlugin({
  toolName,
  args,
  running,
  sessionState,
  target,
  revision,
}: RouteChatPluginProps) {
  const document = recordedRouteDoc(sessionState, parameterLinksRouteState);
  const profile = document ? stagedParameterLinks(document) : null;
  return (
    <InlineRoutePlugin
      title={parameterLinksRouteState.title}
      action={actionLabel(toolName, args, running)}
      revision={revision ?? undefined}
    >
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        {document ? (
          <>
            <Metric value={profile?.definitions.length ?? 0} label="definitions" />
            <Metric value={profile?.assignments.length ?? 0} label="assignments" />
          </>
        ) : (
          <span className="t-small text-ink-2">draft not recorded</span>
        )}
        <span className="t-small face-mono text-ink-2 truncate" data-testid="plugin-target">
          {target ?? "target not recorded"}
        </span>

        <Link
          from="/chat"
          className="ml-auto"
          to="/chat"
          search={(previous) => ({ ...previous, plugin: "parameter-links" })}
        >
          Open workspace
        </Link>
      </div>
    </InlineRoutePlugin>
  );
}

function ParameterLinksLivePlugin({
  toolName,
  args,
  running,
  active,
  target,
}: RouteChatPluginProps) {
  const route = useRoute(parameterLinksManifest, { target });
  if (!route.work.current || !route.work.doc) return null;
  const document = route.work.doc;
  const profile = document ? stagedParameterLinks(document) : null;
  // Observations arrive from the capture owner, the same place the route surface reads them.
  const rows = previousOf(route.readings.links);
  const row = rows
    ? familyCaptureSchema
        .array()
        .parse(rows)
        .find((capture) => capture.reading.kind === "parameter-links")
    : undefined;
  const reading =
    row && row.reading.kind === "parameter-links"
      ? parameterLinksReadingSchema.parse(row.reading.value)
      : null;
  const evaluation = reading?.evaluated ? (reading.evaluation ?? null) : null;
  // Freshness is the reading basis, so chat and the route agree without a second flag.
  const reviewed = evaluationIsCurrent(document, reading);

  const errors = evaluation?.issues.filter((issue) => issue.severity === "error") ?? [];

  return (
    <InlineRoutePlugin
      title={parameterLinksRouteState.title}
      action={actionLabel(toolName, args, running)}
    >
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Metric value={profile?.definitions.length ?? 0} label="definitions" />
        <Metric value={profile?.assignments.length ?? 0} label="assignments" />
        <Metric value={evaluation?.changedWriteCount ?? 0} label="projected writes" />
        <Metric value={evaluation?.issues.length ?? 0} label="issues" issue />

        <Link
          from="/chat"
          className="ml-auto"
          to="/chat"
          search={(previous) => ({ ...previous, plugin: "parameter-links" })}
        >
          Open workspace
        </Link>
      </div>

      {active ? (
        <ParameterLinksReview
          document={document}
          busy={route.busy?.key ?? null}
          error={route.failure?.message ?? null}
          errors={errors.length}
          reviewed={reviewed}
          reading={reading}
          onCommand={(name) => void route.actions[name].run()}
        />
      ) : null}
    </InlineRoutePlugin>
  );
}

function InstancesChatPlugin({
  sessionState,
  toolName,
  args,
  running,
  revision,
}: RouteChatPluginProps) {
  const doc = recordedRouteDoc(sessionState, instancesRouteState);
  const staged = doc?.launch.staged?.value;
  return (
    <InlineRoutePlugin
      title="Instances"
      action={actionLabel(toolName, args, running)}
      revision={revision ?? undefined}
    >
      <span>
        {staged
          ? staged.kind === "start"
            ? `start ${staged.name || "unnamed session"} in Revit ${staged.year}`
            : `open ${staged.document} in ${staged.session}`
          : "no start or open staged"}
      </span>
      <Link from="/chat" to="/chat" search={(previous) => ({ ...previous, plugin: "instances" })}>
        Open workspace
      </Link>
    </InlineRoutePlugin>
  );
}

function TakeoffsReceiptPlugin(props: RouteChatPluginViewProps) {
  const id = actionReceiptId(props.args, props.sessionState);
  const registration = selectRouteChatPlugin(props.toolName, props.args);
  return (
    <InlineRoutePlugin
      title={registration?.spec.title ?? "Action"}
      action="original action receipt"
    >
      <div>
        {id ? (
          <ActionReceiptView id={id} />
        ) : props.running ? (
          "Awaiting action acceptance"
        ) : (
          "This call has no admitted action receipt"
        )}
        <Link
          from="/chat"
          to="/chat"
          search={(previous) => ({
            ...previous,
            plugin:
              registration?.spec.route === "family"
                ? "family"
                : registration?.spec.route === "pods"
                  ? "pods"
                  : "takeoffs",
          })}
        >
          Open active workspace
        </Link>
      </div>
    </InlineRoutePlugin>
  );
}
function TakeoffsChatPlugin(props: RouteChatPluginProps) {
  return <TakeoffsReceiptPlugin {...props} />;
}
