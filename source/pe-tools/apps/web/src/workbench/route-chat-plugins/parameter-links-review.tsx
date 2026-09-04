import type { ReactNode } from "react";
import {
  type ParameterLinksDocument,
  actionLabel,
  cellSummary,
  familyTypesRouteState,
  parseRouteDoc,
  splitCellKey,
} from "@pe/agent-contracts";
import { Check, Eye, RefreshCw } from "lucide-react";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Verb } from "#/components/lang/verb";
import { CellTrichotomyReviewer } from "../trichotomy-reviewer";
import type { RouteChatPluginProps } from "./tool-names";

export function ParameterLinksReview({
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
    <div className="mt-1.5 w-full pt-1.5">
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {profile?.definitions.map((definition) => (
          <div key={definition.id} className="py-1">
            <div className="">{definition.id}</div>
            <div className="">
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
              <div className="truncate">
                {write.targetElementName ?? write.targetElementId} · {write.targetParameter.name}
              </div>
              <div className="truncate">
                {displayParameterLinkValue(write.currentValue)} →{" "}
                {displayParameterLinkValue(write.proposedValue)}
                {write.overrideApplied ? " (override)" : ""}
              </div>
            </div>
          ))}

        {evaluation?.issues.slice(0, 4).map((issue, index) => (
          <div
            key={`${issue.code}:${issue.assignmentId ?? index}`}
            className={issue.severity === "error" ? "" : ""}
          >
            <span className="">{issue.code}</span>: {issue.message}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate">
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

export function sameParameterLinkProfile(left: unknown, right: unknown) {
  return left != null && right != null && JSON.stringify(left) === JSON.stringify(right);
}

export function FamilyTypesChatPlugin({
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
                {paramName} <span className="">· {typeName}</span>
              </>
            );
          }}
        />
      ) : null}
    </InlineRoutePlugin>
  );
}

export function InlineRoutePlugin({
  title,
  action,
  revision,
  children,
}: {
  title: string;
  action: string;
  /** The Scope revision this card's buttons run under; the head shows the same number. */
  revision?: number;
  children: ReactNode;
}) {
  return (
    <ArtifactFrame
      head={
        <div>
          <span className="">{title}</span>
          <span className="">{action}</span>
          {revision !== undefined ? (
            <span className="t-small face-mono text-ink-2" data-testid="plugin-revision">
              r{revision}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2.5 py-2">{children}</div>
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
  return (
    <span className={`inline-flex items-baseline gap-1 ${issue && value > 0 ? "" : ""}`}>
      <span className="">{value}</span>
      <span className="">{label}</span>
    </span>
  );
}

export { actionLabel };

export function displayParameterLinkValue(value: {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
