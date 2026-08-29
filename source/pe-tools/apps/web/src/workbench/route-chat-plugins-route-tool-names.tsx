import type { ComponentType } from "react";
import type { z } from "zod";
import {
  actionLabel,
  familyRouteState,
  familyTypesRouteState,
  parameterLinksRouteState,
  parseRouteDoc,
  scheduleGridRouteState,
  settingsRouteState,
  type RouteStateSpec,
} from "@pe/agent-contracts";
import { Link } from "@tanstack/react-router";
import { useWorkbench } from "./provider";
import { selectToolCalls } from "./chat-state";
import { useRouteState, type RouteStateHandle } from "./route-state";
import { FamilyChatPlugin } from "./plugins/family-chat-plugin";
import { ScheduleGridChatPlugin } from "./plugins/schedule-grid-chat-plugin";
import { SettingsChatPlugin } from "./plugins/settings-chat-plugin";
import { useRouteDocumentAddress } from "./route-document";
import {
  FamilyTypesChatPlugin,
  InlineRoutePlugin,
  Metric,
  ParameterLinksReview,
  isRecord,
  sameParameterLinkProfile,
} from "./route-chat-plugins-parameter-links-review";

export const ROUTE_TOOL_NAMES = new Set(["route_state_read", "route_state_apply", "route_command"]);

export interface RouteChatPluginProps {
  toolCallId: string;
  toolName: string;
  args: unknown;
  sessionState: unknown;
  running: boolean;
  active: boolean;
  routeState: RouteStateHandle<unknown>;
}

export type RouteChatPluginViewProps = Omit<RouteChatPluginProps, "active" | "routeState">;

export interface RouteChatPluginRegistration {
  spec: RouteStateSpec<z.ZodType>;
  Renderer: ComponentType<RouteChatPluginProps>;
}

export const routeChatPluginList: RouteChatPluginRegistration[] = [
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
  if (!ROUTE_TOOL_NAMES.has(toolName) || !isRecord(args) || typeof args.route !== "string")
    return null;
  return routeChatPlugins[args.route] ?? null;
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
        if (!ROUTE_TOOL_NAMES.has(call.title) || !isRecord(call.args)) return [];
        const route = call.args.route;
        return typeof route === "string" && routeChatPlugins[route] ? [route] : [];
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
          toolName="route_command"
          args={{ route: registration.spec.route, command: "Review" }}
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
  const documentAddress = useRouteDocumentAddress();
  if (!documentAddress) return null;
  return (
    <AddressedRouteChatPlugin
      registration={registration}
      {...props}
      documentAddress={documentAddress}
    />
  );
}

export function AddressedRouteChatPlugin({
  registration,
  documentAddress,
  ...props
}: RouteChatPluginViewProps & {
  active: boolean;
  registration: RouteChatPluginRegistration;
  documentAddress: import("@pe/agent-contracts").Address;
}) {
  const route = useRouteState(registration.spec, { documentAddress });
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
          className="ml-auto text-nav hover:underline"
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
