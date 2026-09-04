import { instancesRouteState } from "@pe/agent-contracts";
import type { ComponentType } from "react";
import type { z } from "zod";
import {
  actionLabel,
  routeCallOf,
  familyRouteState,
  podsRouteState,
  familyTypesRouteState,
  parameterLinksRouteState,
  parseRouteDoc,
  scheduleGridRouteState,
  settingsRouteState,
  type RouteStateSpec,
} from "@pe/agent-contracts";
import { Link } from "@tanstack/react-router";
import { useWorkbench } from "../provider";
import { selectToolCalls } from "../chat-state";
import { useRouteState, type RouteStateHandle } from "../route-state";
import { FamilyChatPlugin } from "../plugins/family-chat-plugin";
import { ScheduleGridChatPlugin } from "../plugins/schedule-grid-chat-plugin";
import { SettingsChatPlugin } from "../plugins/settings-chat-plugin";
import { PodsChatPlugin } from "./pods-chat-plugin";
import { useThreadScope } from "#/chat/scope";
import {
  FamilyTypesChatPlugin,
  InlineRoutePlugin,
  Metric,
  ParameterLinksReview,
  isRecord,
  sameParameterLinkProfile,
} from "./parameter-links-review";

export interface RouteChatPluginProps {
  toolCallId: string;
  toolName: string;
  args: unknown;
  sessionState: unknown;
  running: boolean;
  active: boolean;
  routeState: RouteStateHandle<unknown>;
  /** The thread's current Scope revision; a command button pressed here runs under it. */
  revision: number;
}

export type RouteChatPluginViewProps = Omit<
  RouteChatPluginProps,
  "active" | "routeState" | "revision"
>;

export interface RouteChatPluginRegistration {
  spec: RouteStateSpec<z.ZodType>;
  Renderer: ComponentType<RouteChatPluginProps>;
}

export const routeChatPluginList: RouteChatPluginRegistration[] = [
  { spec: instancesRouteState, Renderer: InstancesChatPlugin },
  { spec: podsRouteState, Renderer: PodsChatPlugin },
  {
    spec: parameterLinksRouteState,
    Renderer: ParameterLinksChatPlugin,
  },
  {
    spec: familyTypesRouteState,
    Renderer: FamilyTypesChatPlugin,
  },
  {
    spec: settingsRouteState,
    Renderer: SettingsChatPlugin,
  },
  {
    spec: familyRouteState,
    Renderer: FamilyChatPlugin,
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
  "pods",
  "family",
  "families",
  "settings",
  "parameter-links",
  "schedule-grid",
] as const;

export type ChatPluginRoute = (typeof CHAT_PLUGIN_ROUTES)[number];

export function chatPluginTitle(route: string): string {
  return routeChatPlugins[route]?.spec.title ?? (route === "families" ? "Families" : route);
}

export function selectRouteChatPlugin(
  toolName: string,
  args: unknown,
): RouteChatPluginRegistration | null {
  const call = routeCallOf(toolName, args);
  return call ? (routeChatPlugins[call.route] ?? null) : null;
}

export function RouteChatPluginView(props: RouteChatPluginViewProps) {
  const registration = selectRouteChatPlugin(props.toolName, props.args);
  return registration ? (
    <ConnectedRouteChatPlugin registration={registration} {...props} active={false} />
  ) : null;
}

export function RouteChatPluginDock() {
  const { chat, isRunning } = useWorkbench();
  const registrations = Array.from(
    new Set(
      selectToolCalls(chat).flatMap((call) => {
        const route = routeCallOf(call.title, call.args)?.route;
        return route && routeChatPlugins[route] ? [route] : [];
      }),
    ),
  ).map((route) => routeChatPlugins[route]);

  if (isRunning || registrations.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {registrations.map((registration) => (
        <ConnectedRouteChatPlugin
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

export function ConnectedRouteChatPlugin({
  registration,
  ...props
}: RouteChatPluginViewProps & { active: boolean; registration: RouteChatPluginRegistration }) {
  const { currentThreadId } = useWorkbench();
  const threadScope = useThreadScope(currentThreadId);
  if (!threadScope.hydrated) return null;
  return (
    <ScopedRouteChatPlugin
      registration={registration}
      {...props}
      scope={threadScope.scope}
      revision={threadScope.revision}
    />
  );
}

export function ScopedRouteChatPlugin({
  registration,
  scope,
  ...props
}: RouteChatPluginViewProps & {
  active: boolean;
  revision: number;
  registration: RouteChatPluginRegistration;
  scope: import("@pe/agent-contracts").Scope;
}) {
  const route = useRouteState(registration.spec, { scope });
  if (!route.hydrated || route.slice == null) return null;
  const Renderer = registration.Renderer;
  return <Renderer {...props} sessionState={route.slice} routeState={route} />;
}

export function ParameterLinksChatPlugin({
  toolName,
  args,
  sessionState,
  running,
  active,
  routeState,
}: RouteChatPluginProps) {
  const document = parseRouteDoc(sessionState, parameterLinksRouteState);
  const profile = document?.draftProfile ?? document?.profile;
  const evaluation = document?.evaluation;
  const previewed =
    routeState.lastCommand?.command === "preview" && isRecord(routeState.lastCommand.input)
      ? routeState.lastCommand.input.profile
      : null;

  const errors = evaluation?.issues.filter((issue) => issue.severity === "error") ?? [];

  const command = (name: "refresh" | "preview" | "apply") =>
    routeState.command(name, name === "refresh" ? undefined : { profile });

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
          busy={routeState.busy}
          error={routeState.failure?.message ?? null}
          errors={errors.length}
          reviewed={sameParameterLinkProfile(profile, previewed)}
          onCommand={(name) => void command(name).catch(() => undefined)}
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
  const doc = parseRouteDoc(sessionState, instancesRouteState);
  const staged = doc?.staged;
  return (
    <InlineRoutePlugin
      title="Instances"
      action={actionLabel(toolName, args, running)}
      revision={revision}
    >
      <span>
        {staged
          ? staged.kind === "start"
            ? `start ${staged.name || "unnamed session"} in Revit ${staged.year}`
            : `open ${staged.document} in ${staged.session}`
          : (doc?.selectedSession ?? "no session selected")}
      </span>
      <Link to="/chat" search={(previous) => ({ ...previous, plugin: "instances" })}>
        Open workspace
      </Link>
    </InlineRoutePlugin>
  );
}
