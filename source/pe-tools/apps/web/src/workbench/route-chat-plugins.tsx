import { useState, type ComponentType, type ReactNode } from "react";
import type { z } from "zod";
import {
  type FamilyTypesDocument,
  type ParameterLinksDocument,
  cellSummary,
  familyRouteState,
  familyTypesRouteState,
  parameterLinksRouteState,
  readRouteState,
  scheduleGridRouteState,
  settingsRouteState,
  splitCellKey,
  type RouteStateSpec,
} from "@pe/agent-contracts";
import { Check, Eye, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";
import { useWorkbench } from "./provider";
import { type RouteStateWriteResult, useRouteState, writeRouteState } from "./route-state";
import { CellTrichotomyReviewer } from "./trichotomy-reviewer";
import { FamilyChatPlugin } from "./plugins/family-chat-plugin";
import { ScheduleGridChatPlugin } from "./plugins/schedule-grid-chat-plugin";
import { SettingsChatPlugin } from "./plugins/settings-chat-plugin";

const ROUTE_TOOL_NAMES = new Set(["route_state_read", "route_state_apply", "route_command"]);

export interface RouteChatPluginProps {
  toolCallId: string;
  toolName: string;
  args: unknown;
  sessionState: Record<string, unknown>;
  running: boolean;
  active: boolean;
}

type RouteChatPluginViewProps = Omit<RouteChatPluginProps, "active">;

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

/**
 * Workspace-only plugins: iframed routes with NO route-state slice and NO inline tool card —
 * pea has no route tools for them by design (instances lifecycle is user-click or pe_sandbox
 * MCP only, never a route command).
 */
const workspaceOnlyPlugins: Record<string, string> = {
  instances: "Instances",
};

/** Route names hostable as chat workspace plugins — registry + workspace-only routes. */
export const CHAT_PLUGIN_ROUTES = [
  ...Object.keys(routeChatPlugins),
  ...Object.keys(workspaceOnlyPlugins),
] as [string, ...string[]];
export type ChatPluginRoute = string;

export function chatPluginTitle(route: string): string {
  return routeChatPlugins[route]?.spec.title ?? workspaceOnlyPlugins[route] ?? route;
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
 * The transcript projection drops completed tool calls from its live-tool list and may briefly lag
 * route state after `agent_end`. Keep exactly one authoritative reviewer at the end of chat; inline
 * tool cards remain the historical record of how Pea changed the route.
 */
export function RouteChatPluginDock() {
  const { debug, isRunning } = useWorkbench();
  const registrations = Array.from(
    new Set(
      debug.state.tools.calls.flatMap((call) => {
        if (!ROUTE_TOOL_NAMES.has(call.title) || !isRecord(call.rawInput)) return [];
        const route = call.rawInput.route;
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
}: RouteChatPluginProps & { registration: RouteChatPluginRegistration }) {
  const route = useRouteState(registration.spec);
  if (!route.hydrated || route.slice == null) return null;
  const Renderer = registration.Renderer;
  return <Renderer {...props} sessionState={{ [registration.spec.key]: route.slice }} />;
}

function ParameterLinksChatPlugin({
  toolName,
  args,
  sessionState,
  running,
  active,
}: RouteChatPluginProps) {
  const document = readRouteState(sessionState, parameterLinksRouteState);
  const profile = document?.draftProfile ?? document?.profile;
  const evaluation = document?.evaluation;
  const { config } = useWorkbench();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewedProfile, setPreviewedProfile] = useState<NonNullable<typeof profile> | null>(
    null,
  );

  const errors = evaluation?.issues.filter((issue) => issue.severity === "error") ?? [];

  const command = async (name: "refresh" | "preview" | "apply") => {
    const commandProfile = name === "apply" ? previewedProfile : profile;
    if (name !== "refresh" && !commandProfile) return;
    setBusy(name);
    setError(null);
    try {
      const result = await writeRouteState(config, "parameter-links", "command", {
        command: name,
        input: name === "refresh" ? {} : { profile: commandProfile },
      });
      if (!result.ok) {
        setError(result.error ?? result.hint ?? `${name} failed.`);
      } else if (name === "preview" && profile) {
        setPreviewedProfile(profile);
      } else {
        setPreviewedProfile(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${name} failed.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <InlineRoutePlugin title="Parameter Links" action={actionLabel(toolName, args, running)}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Metric value={profile?.definitions.length ?? 0} label="definitions" />
        <Metric value={profile?.assignments.length ?? 0} label="assignments" />
        <Metric value={evaluation?.changedWriteCount ?? 0} label="projected writes" />
        <Metric value={evaluation?.issues.length ?? 0} label="issues" issue />
        <Link
          className="ml-auto font-medium text-[var(--pe-blue)] hover:underline"
          to="/chat"
          search={(previous) => ({ ...previous, plugin: "parameter-links" })}
        >
          Open workspace
        </Link>
      </div>

      {active ? (
        <ParameterLinksReview
          document={document}
          busy={busy}
          error={error}
          errors={errors.length}
          reviewed={sameParameterLinkProfile(profile, previewedProfile)}
          onCommand={(name) => void command(name)}
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
    <div className="mt-1.5 w-full border-t border-[var(--line-2)] pt-1.5">
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {profile?.definitions.map((definition) => (
          <div key={definition.id} className="border-b border-[var(--line-2)] py-1 last:border-0">
            <div className="font-medium text-[var(--clay-ink)]">{definition.id}</div>
            <div className="text-[10px] text-[var(--lichen)]">
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
              <div className="truncate font-medium text-[var(--clay-ink)]">
                {write.targetElementName ?? write.targetElementId} · {write.targetParameter.name}
              </div>
              <div className="truncate font-mono text-[10px] text-[var(--lichen)] tabular-nums">
                {displayParameterLinkValue(write.currentValue)} →{" "}
                {displayParameterLinkValue(write.proposedValue)}
                {write.overrideApplied ? " (override)" : ""}
              </div>
            </div>
          ))}
        {evaluation?.issues.slice(0, 4).map((issue, index) => (
          <div
            key={`${issue.code}:${issue.assignmentId ?? index}`}
            className={issue.severity === "error" ? "text-[var(--fail)]" : "text-[var(--lichen)]"}
          >
            <strong>{issue.code}</strong>: {issue.message}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--lichen)]">
          {error ??
            (errors > 0
              ? `${errors} blocking error${errors === 1 ? "" : "s"}`
              : "Review the preview before applying.")}
        </span>
        <div className="flex gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            title="Refresh from Revit"
            disabled={busy != null}
            onClick={() => onCommand("refresh")}
          >
            <RefreshCw />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!profile || busy != null}
            onClick={() => onCommand("preview")}
          >
            <Eye /> Preview
          </Button>
          <Button
            size="sm"
            disabled={!profile || !reviewed || errors > 0 || busy != null}
            onClick={() => onCommand("apply")}
          >
            <Check /> Apply
          </Button>
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
}: RouteChatPluginProps) {
  const document = readRouteState(sessionState, familyTypesRouteState);
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
    <InlineRoutePlugin title="Family Types" action={actionLabel(toolName, args, running)}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Metric value={openProposals} label="open proposals" />
        <Metric value={summary.staged} label="staged" />
        <Metric value={summary.attention} label="need attention" issue />
        <Link
          className="ml-auto font-medium text-[var(--pe-blue)] hover:underline"
          to="/chat"
          search={(previous) => ({ ...previous, plugin: "family-types" })}
        >
          Open workspace
        </Link>
      </div>

      {active && reviewable ? (
        <CellTrichotomyReviewer
          route="family-types"
          segment="cells"
          cells={cells}
          commitCommand="push"
          commitLabel={(staged) => `Push ${staged} to Revit`}
          reviewHint="Pea can propose; only you can push."
          renderLabel={(key) => {
            const { paramName, typeName } = splitCellKey(key);
            return (
              <>
                {paramName} <span className="font-normal text-[var(--lichen)]">· {typeName}</span>
              </>
            );
          }}
        />
      ) : null}
    </InlineRoutePlugin>
  );
}

/** Kept for the route-chat-plugins test; the inline card derives counts via `cellSummary`. */
export function summarizeFamilyTypes(document: FamilyTypesDocument | null) {
  const entries = Object.entries(document?.cells ?? {});
  const items = entries.filter(([, cell]) => cell.proposal != null || cell.staged != null);
  const staged = entries.filter(([, cell]) => cell.staged != null);
  return {
    items,
    proposalCount: entries.filter(([, cell]) => cell.proposal != null && cell.staged == null)
      .length,
    stagedCount: staged.length,
    attentionCount: items.filter(([, cell]) => cell.review === "attention").length,
    canPush: staged.length > 0 && staged.every(([, cell]) => cell.review !== "attention"),
  };
}

export function familyTypesWriteError(result: RouteStateWriteResult): string | null {
  if (!result.ok) return result.error ?? result.hint ?? "Route update failed.";
  if (!isRecord(result.result) || !Array.isArray(result.result.failures)) return null;
  const failures = result.result.failures.filter(isRecord);
  if (failures.length === 0) return null;
  const first = failures[0];
  const detail = [first?.key, first?.error].filter((part) => typeof part === "string").join(": ");
  return `${failures.length} value${failures.length === 1 ? "" : "s"} failed${detail ? `: ${detail}` : "."}`;
}

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
    <div className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2.5 py-2 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-[var(--clay-ink)]">{title}</span>
        <span className="tele-label text-[var(--lichen)]">{action}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[var(--slate)]">{children}</div>
    </div>
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
  return (
    <span
      className={`inline-flex items-baseline gap-1 ${
        issue && value > 0 ? "text-[var(--fail)]" : undefined
      }`}
    >
      <span className="tele">{value}</span>
      <span className="tele-label">{label}</span>
    </span>
  );
}

export function actionLabel(toolName: string, args: unknown, running: boolean): string {
  const command = isRecord(args) && typeof args.command === "string" ? args.command : null;
  const action =
    toolName === "route_state_read"
      ? "Read"
      : toolName === "route_state_apply"
        ? "Draft update"
        : command === "refresh"
          ? "Refresh"
          : command === "preview"
            ? "Preview"
            : command === "apply"
              ? "Apply"
              : (command ?? "Command");
  return running ? `${action} in progress` : action;
}

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
