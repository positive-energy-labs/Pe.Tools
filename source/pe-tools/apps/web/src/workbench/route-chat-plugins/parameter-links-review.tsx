import type { ReactNode } from "react";
import {
  type ParameterLinksDocument,
  type ParameterLinksReading,
  actionLabel,
  stagedParameterLinks,
} from "@pe/agent-contracts";
import { Eye, RefreshCw } from "lucide-react";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { ActionButton } from "#/components/lang/action-button";

export function ParameterLinksReview({
  document,
  busy,
  error,
  errors,
  reviewed,
  reading,
  onCommand,
}: {
  document: ParameterLinksDocument | null;
  busy: string | null;
  error: string | null;
  errors: number;
  reviewed: boolean;
  reading: ParameterLinksReading | null;
  onCommand: (name: "refresh" | "preview") => void;
}) {
  const profile = document ? stagedParameterLinks(document) : null;
  const evaluation = reading?.evaluated ? (reading.evaluation ?? null) : null;
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
              : reviewed
                ? "Previewed. Apply is armed on the /parameter-links surface."
                : "Preview this draft, then apply it on the /parameter-links surface.")}
        </span>
        <div className="flex gap-1">
          <ActionButton
            label="Refresh"
            icon={RefreshCw}
            busy={busy === "refresh"}
            disabled={busy != null}
            reason="Re-read definitions and evaluation from the live Revit session"
            onClick={() => onCommand("refresh")}
          />
          <ActionButton
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
        </div>
      </div>
    </div>
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
  // The card folds: it is evidence beside a call, not the call. Open by default would make every
  // receipt in a long thread a wall.
  return (
    <ArtifactFrame
      head={
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="t-small t-upper text-ink">{title}</span>
          <span className="truncate t-small text-ink-2">{action}</span>
          {revision !== undefined ? (
            <span className="t-small face-mono text-ink-2" data-testid="plugin-revision">
              r{revision}
            </span>
          ) : null}
        </div>
      }
    >
      {/* min-w-0 is what stops a wide <pre> inside from blowing the card past the lane; the
          overflow then belongs to the card, not the page. */}
      <details className="min-w-0" open>
        <summary className="cursor-pointer px-2.5 py-1 t-small text-ink-2">details</summary>
        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 overflow-x-auto px-2.5 pb-2">
          {children}
        </div>
      </details>
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
