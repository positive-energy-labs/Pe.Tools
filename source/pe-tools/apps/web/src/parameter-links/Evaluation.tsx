/**
 * Read-only projection of the last evaluation: the projected target writes
 * (current → proposed; a pending write is UNSAVED, so it is bold — the reserved
 * weight), the issues (error = the host refusing the plan → refused/alarm;
 * warning → advisory), and the runtime status the host reported.
 */
import type {
  ParameterLinkEvaluation,
  ParameterLinkValue,
  ParameterLinksRuntimeStatus,
} from "@pe/agent-contracts";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";

export function displayParameterLinkValue(value: ParameterLinkValue): string {
  if (value.displayValue) return value.displayValue;
  const raw = value.doubleValue ?? value.integerValue ?? value.stringValue ?? value.elementIdValue;
  return raw == null ? "—" : String(raw);
}

export function RuntimeStatusBar({
  status,
  appliedWriteCount,
}: {
  status: ParameterLinksRuntimeStatus | null | undefined;
  appliedWriteCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FactChip
        tone={status?.updaterRegistered ? "done" : "meta"}
        title={
          status?.updaterRegistered
            ? "the host's parameter-link updater is registered and reacting to model changes"
            : "no updater registered — links only reconcile when applied from here"
        }
      >
        {status?.updaterRegistered ? "updater · registered" : "updater · idle"}
      </FactChip>
      <FactChip title="link definitions the host is actively maintaining">
        {status?.activeDefinitionCount ?? 0} active defs
      </FactChip>
      <FactChip title="assignments the host is actively maintaining">
        {status?.activeAssignmentCount ?? 0} active asns
      </FactChip>
      <FactChip title="target-parameter writes the last apply performed">
        {appliedWriteCount} applied writes
      </FactChip>
    </div>
  );
}

export function EvaluationView({
  evaluation,
}: {
  evaluation: ParameterLinkEvaluation | null | undefined;
}) {
  if (!evaluation) {
    return (
      <EmptyState story="scope" exit="run Preview to project the draft's target writes">
        no evaluation yet
      </EmptyState>
    );
  }

  const writes = evaluation.writes;
  const changed = writes.filter((write) => write.changed);
  const errorCount = evaluation.issues.filter((issue) => issue.severity === "error").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <FactChip title="source elements the evaluation read">
          {evaluation.sourceElementCount} sources
        </FactChip>
        <FactChip title="target elements the evaluation projected onto">
          {evaluation.targetElementCount} targets
        </FactChip>
        <FactChip
          tone={evaluation.changedWriteCount > 0 ? "caution" : "meta"}
          title="writes whose proposed value differs from the current one — what apply would change"
        >
          {evaluation.changedWriteCount} projected writes
        </FactChip>
        {evaluation.issues.length > 0 && (
          <FactChip
            tone={errorCount > 0 ? "alarm" : "caution"}
            title={
              errorCount > 0
                ? "error-severity issues block apply until resolved"
                : "warnings — apply is not blocked"
            }
          >
            {evaluation.issues.length} issues
          </FactChip>
        )}
      </div>

      {evaluation.issues.length > 0 ? (
        <div>
          {evaluation.issues.map((issue, index) => (
            <OutcomeLine
              key={`${issue.code}:${issue.assignmentId ?? issue.definitionId ?? index}`}
              kind={issue.severity === "error" ? "refused" : "advisory"}
              label={issue.code}
              says={issue.message}
            />
          ))}
        </div>
      ) : null}

      {writes.length === 0 ? (
        <EmptyState
          story="scope"
          exit="add assignments that bind source elements, then preview again"
        >
          the evaluation produced no target writes
        </EmptyState>
      ) : (
        <ArtifactFrame>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="t-caption t-upper px-2 py-1.5 text-ink-2">Target</th>
                <th className="t-caption t-upper px-2 py-1.5 text-ink-2">Parameter</th>
                <th className="t-caption t-upper px-2 py-1.5 text-ink-2">Current</th>
                <th className="t-caption t-upper px-2 py-1.5 text-ink-2">Linked</th>
                <th className="t-caption t-upper px-2 py-1.5 text-ink-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {writes.map((write) => (
                <tr
                  key={`${write.assignmentId}:${write.targetElementUniqueId}:${write.targetParameter.name ?? write.targetParameter.kind}`}
                  className="border-b border-line last:border-b-0"
                >
                  <td
                    className={
                      write.changed
                        ? "t-value max-w-[14rem] truncate px-2 py-1 text-ink"
                        : "t-value max-w-[14rem] truncate px-2 py-1 text-ink-mute"
                    }
                  >
                    {write.targetElementName ?? write.targetElementId}
                  </td>
                  <td
                    className={
                      write.changed
                        ? "t-value px-2 py-1 text-ink-2"
                        : "t-value px-2 py-1 text-ink-mute"
                    }
                  >
                    {write.targetParameter.name ?? write.targetParameter.kind}
                  </td>
                  <td className="t-value face-mono px-2 py-1 text-ink-mute">
                    {displayParameterLinkValue(write.currentValue)}
                  </td>
                  <td className="t-value face-mono px-2 py-1 text-ink-mute">
                    {displayParameterLinkValue(write.linkedValue)}
                  </td>
                  {/* A changed result is a PENDING write — unsaved until apply — so it takes
                      the reserved weight. An unchanged one is a no-op and stays muted. */}
                  <td
                    className={
                      write.changed
                        ? "t-value face-mono px-2 py-1 font-bold text-ink"
                        : "t-value face-mono px-2 py-1 text-ink-mute"
                    }
                  >
                    {displayParameterLinkValue(write.proposedValue)}
                    {write.overrideApplied ? " (override)" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ArtifactFrame>
      )}

      {changed.length === 0 && writes.length > 0 ? (
        <OutcomeLine
          kind="advisory"
          label="0 changed"
          says="every target already matches its source — apply is a no-op"
        />
      ) : null}
    </div>
  );
}
