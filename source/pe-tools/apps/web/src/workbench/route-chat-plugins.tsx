import type { ComponentType, ReactNode } from "react";
import type { z } from "zod";
import {
  type ParameterLinksDocument,
  actionLabel,
  cellSummary,
  familyRouteState,
  familyTypesRouteState,
  parameterLinksRouteState,
  parseRouteDoc,
  scheduleGridRouteState,
  settingsRouteState,
  splitCellKey,
  type RouteStateSpec,
} from "@pe/agent-contracts";
import { Check, Eye, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Verb } from "#/components/lang/verb";
import { useWorkbench } from "./provider";
import { selectToolCalls } from "./chat-state";
import { useRouteState, type RouteStateHandle } from "./route-state";
import { CellTrichotomyReviewer } from "./trichotomy-reviewer";
import { FamilyChatPlugin } from "./plugins/family-chat-plugin";
import { ScheduleGridChatPlugin } from "./plugins/schedule-grid-chat-plugin";
import { SettingsChatPlugin } from "./plugins/settings-chat-plugin";
import { useRouteDocumentAddress } from "./route-document";

const ROUTE_TOOL_NAMES = new Set(["route_state_read", "route_state_apply", "route_command"]);

export interface RouteChatPluginProps {
  toolCallId: string;
  toolName: string;
  args: unknown;
  sessionState: unknown;
  running: boolean;
  active: boolean;
  routeState: RouteStateHandle<unknown>;
}

type RouteChatPluginViewProps = Omit<RouteChatPluginProps, "active" | "routeState">;

export interface RouteChatPluginRegistration {
  spec: RouteStateSpec<z.ZodType>;
  Renderer: ComponentType<RouteChatPluginProps>;
}

const routeChatPluginList: RouteChatPluginRegistration[] = [
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

const routeChatPlugins = Object.fromEntries(
  routeChatPluginList.map((registration) => [registration.spec.route, registration]),
) as Record<string, RouteChatPluginRegistration>;

/** Routes with an in-realm chat pane. */
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

/**
 * Inline tool cards are the historical record of how Pea changed a route; this dock is the one
 * authoritative reviewer, rendered at the end of chat once the run settles.
 */
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

function ConnectedRouteChatPlugin({
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

function AddressedRouteChatPlugin({
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

function ParameterLinksChatPlugin({
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
        {/* nav is blue TEXT — the legal half of the blue budget */}
        <Link
          className="ml-auto text-[var(--r-nav)] hover:underline"
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
          error={routeState.error}
          errors={errors.length}
          reviewed={sameParameterLinkProfile(profile, previewed)}
          onCommand={(name) => void command(name).catch(() => undefined)}
        />
      ) : null}
    </InlineRoutePlugin>
  );
}

function ParameterLinksReview({
  document,
  busy,
  error,
  errors,
  reviewed,
  onCommand,
}: {
  document: ParameterLinksDocument | null;
  busy: string | null;
  error: string | null;
  errors: number;
  reviewed: boolean;
  onCommand: (name: "refresh" | "preview" | "apply") => void;
}) {
  const profile = document?.draftProfile ?? document?.profile;
  const evaluation = document?.evaluation;
  return (
    <div className="mt-1.5 w-full border-t border-[var(--r-line-2)] pt-1.5">
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {profile?.definitions.map((definition) => (
          <div key={definition.id} className="border-b border-[var(--r-line)] py-1 last:border-0">
            <div className="t-value text-[var(--r-ink)]">{definition.id}</div>
            <div className="t-caption face-mono text-[var(--r-ink-2)]">
              {definition.relationship} · {definition.reducer} · category{" "}
              {definition.sourceCategoryId}
            </div>
          </div>
        ))}
        {evaluation?.writes
          .filter((write) => write.changed)
          .slice(0, 5)
          .map((write) => (
            <div key={`${write.assignmentId}:${write.targetElementUniqueId}`} className="py-1">
              <div className="truncate t-value text-[var(--r-ink)]">
                {write.targetElementName ?? write.targetElementId} · {write.targetParameter.name}
              </div>
              <div className="truncate t-caption face-mono text-[var(--r-ink-2)] tabular-nums">
                {displayParameterLinkValue(write.currentValue)} →{" "}
                {displayParameterLinkValue(write.proposedValue)}
                {write.overrideApplied ? " (override)" : ""}
              </div>
            </div>
          ))}
        {/* a blocking evaluation error IS the machine refusing the plan — the one alarm */}
        {evaluation?.issues.slice(0, 4).map((issue, index) => (
          <div
            key={`${issue.code}:${issue.assignmentId ?? index}`}
            className={
              issue.severity === "error" ? "text-[var(--r-alarm)]" : "text-[var(--r-ink-2)]"
            }
          >
            <span className="face-mono">{issue.code}</span>: {issue.message}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate t-caption text-[var(--r-ink-2)]">
          {error ??
            (errors > 0
              ? `${errors} blocking error${errors === 1 ? "" : "s"}`
              : "Review the preview before applying.")}
        </span>
        <div className="flex gap-1">
          <Verb
            label="Refresh"
            icon={RefreshCw}
            busy={busy === "refresh"}
            disabled={busy != null}
            reason="Re-read definitions and evaluation from the live Revit session"
            onClick={() => onCommand("refresh")}
          />
          <Verb
            label="Preview"
            icon={Eye}
            busy={busy === "preview"}
            disabled={!profile || busy != null}
            reason={
              profile
                ? "Evaluate the profile against the model — shows every projected write, changes nothing"
                : "No profile to preview — pea has not drafted one yet"
            }
            onClick={() => onCommand("preview")}
          />
          <Verb
            tone="commit"
            label="Apply"
            icon={Check}
            busy={busy === "apply"}
            disabled={!profile || !reviewed || errors > 0 || busy != null}
            reason={
              !profile
                ? "No profile to apply — pea has not drafted one yet"
                : errors > 0
                  ? "Blocked: resolve the blocking evaluation errors first"
                  : !reviewed
                    ? "Preview first — apply only writes the exact profile you previewed"
                    : "Write the previewed parameter values into the live Revit model"
            }
            onClick={() => onCommand("apply")}
          />
        </div>
      </div>
    </div>
  );
}

function sameParameterLinkProfile(left: unknown, right: unknown) {
  return left != null && right != null && JSON.stringify(left) === JSON.stringify(right);
}

function FamilyTypesChatPlugin({
  toolName,
  args,
  sessionState,
  running,
  active,
  routeState,
}: RouteChatPluginProps) {
  const document = parseRouteDoc(sessionState, familyTypesRouteState);
  const cells = document?.cells ?? {};
  const summary = cellSummary(cells);
  const openProposals = Object.values(cells).filter(
    (cell) => cell.proposal != null && cell.staged == null,
  ).length;
  const reviewable = Object.values(cells).some(
    (cell) => cell.proposal != null || cell.staged != null,
  );

  if (active && !reviewable) return null;

  return (
    <InlineRoutePlugin
      title={familyTypesRouteState.title}
      action={actionLabel(toolName, args, running)}
    >
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Metric value={openProposals} label="open proposals" />
        <Metric value={summary.staged} label="staged" />
        <Metric value={summary.attention} label="need attention" issue />
        {/* No workspace link: the /family-types route is gone; this slice lives on only for
            pea's tools and these inline cards. */}
      </div>

      {active && reviewable ? (
        <CellTrichotomyReviewer
          state={routeState}
          segment="cells"
          cells={cells}
          commitCommand="push"
          commitLabel={(staged) => `Push ${staged} to Revit`}
          reviewHint="Pea can propose; only you can push."
          renderLabel={(key) => {
            const { paramName, typeName } = splitCellKey(key);
            return (
              <>
                {paramName} <span className="text-[var(--r-ink-2)]">· {typeName}</span>
              </>
            );
          }}
        />
      ) : null}
    </InlineRoutePlugin>
  );
}

/** Pea's inline route card — a machine-operated object carrying state, so it IS an artifact:
 * the one enclosure the border budget grants this surface's chat lane. The head carries the
 * route name and pea's action (machine-measured, mono). */
export function InlineRoutePlugin({
  title,
  action,
  children,
}: {
  title: string;
  action: string;
  children: ReactNode;
}) {
  return (
    <ArtifactFrame
      head={
        <div className="flex w-full items-baseline justify-between gap-3">
          <span className="t-label t-upper text-[var(--r-ink-2)]">{title}</span>
          <span className="t-caption face-mono text-[var(--r-ink-2)]">{action}</span>
        </div>
      }
    >
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2.5 py-2 t-label text-[var(--r-ink-2)]">
        {children}
      </div>
    </ArtifactFrame>
  );
}

export function Metric({
  value,
  label,
  issue = false,
}: {
  value: number;
  label: string;
  issue?: boolean;
}) {
  // A non-zero issue count is attention owed — caution, never the alarm.
  return (
    <span
      className={`inline-flex items-baseline gap-1 ${
        issue && value > 0 ? "text-[var(--r-caution)]" : ""
      }`}
    >
      <span className="t-value face-mono">{value}</span>
      <span className="t-caption face-mono">{label}</span>
    </span>
  );
}

export { actionLabel };

function displayParameterLinkValue(value: {
  displayValue?: string | null;
  doubleValue?: number | null;
  integerValue?: number | null;
  stringValue?: string | null;
  elementIdValue?: number | null;
}): string {
  if (value.displayValue) return value.displayValue;
  return String(
    value.doubleValue ?? value.integerValue ?? value.stringValue ?? value.elementIdValue ?? "-",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
