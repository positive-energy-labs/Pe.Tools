/**
 * Read-only projection of the last evaluation: the projected target writes
 * (current → proposed, changed-flagged), the issues (severity-styled), and the
 * runtime status the host reported (updater registration + active counts).
 */
import type {
  ParameterLinkEvaluation,
  ParameterLinkValue,
  ParameterLinksRuntimeStatus,
} from "@pe/agent-contracts";

import { Metric } from "#/workbench/route-chat-plugins";

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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span
        className={`inline-flex items-center gap-1.5 text-xs ${
          status?.updaterRegistered ? "text-[var(--cat-green)]" : "text-muted-foreground"
        }`}
      >
        <span
          className={`size-2 rounded-full ${
            status?.updaterRegistered ? "bg-[var(--cat-green)]" : "bg-muted-foreground/40"
          }`}
        />
        {status?.updaterRegistered ? "Updater registered" : "Updater idle"}
      </span>
      <Metric value={status?.activeDefinitionCount ?? 0} label="active defs" />
      <Metric value={status?.activeAssignmentCount ?? 0} label="active assigns" />
      <Metric value={appliedWriteCount} label="applied writes" />
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
      <p className="px-1 py-6 text-center text-xs text-[var(--lichen)]">
        No evaluation yet — Preview the draft to project its target writes.
      </p>
    );
  }

  const writes = evaluation.writes;
  const changed = writes.filter((write) => write.changed);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Metric value={evaluation.sourceElementCount} label="source elements" />
        <Metric value={evaluation.targetElementCount} label="target elements" />
        <Metric value={evaluation.changedWriteCount} label="projected writes" />
        <Metric value={evaluation.issues.length} label="issues" issue />
      </div>

      {evaluation.issues.length > 0 ? (
        <ul className="space-y-1">
          {evaluation.issues.map((issue, index) => (
            <li
              key={`${issue.code}:${issue.assignmentId ?? issue.definitionId ?? index}`}
              className={`rounded-[2px] border-l-2 px-2 py-1 text-xs ${
                issue.severity === "error"
                  ? "border-[var(--fail)] bg-[var(--fail)]/8 text-[var(--fail)]"
                  : "border-[var(--cat-clay)] bg-[var(--cat-clay)]/8 text-[var(--cat-clay)]"
              }`}
            >
              <span className="font-medium">{issue.code}</span>
              <span className="opacity-80"> · {issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {writes.length === 0 ? (
        <p className="px-1 py-4 text-xs text-[var(--lichen)]">
          Evaluation produced no target writes.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[2px] border border-[var(--line-2)]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--line-2)] text-[var(--lichen)]">
                <th className="px-2 py-1.5 font-medium">Target</th>
                <th className="px-2 py-1.5 font-medium">Parameter</th>
                <th className="px-2 py-1.5 font-medium">Current</th>
                <th className="px-2 py-1.5 font-medium">Linked</th>
                <th className="px-2 py-1.5 font-medium">Result</th>
                <th className="px-2 py-1.5 font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {writes.map((write) => (
                <tr
                  key={`${write.assignmentId}:${write.targetElementUniqueId}:${write.targetParameter.name ?? write.targetParameter.kind}`}
                  className={`border-b border-[var(--line-2)] last:border-b-0 ${
                    write.changed ? "" : "opacity-55"
                  }`}
                >
                  <td className="max-w-[14rem] truncate px-2 py-1 text-[var(--clay-ink)]">
                    {write.targetElementName ?? write.targetElementId}
                  </td>
                  <td className="px-2 py-1 text-[var(--slate)]">
                    {write.targetParameter.name ?? write.targetParameter.kind}
                  </td>
                  <td className="px-2 py-1 font-mono tabular-nums text-[var(--lichen)]">
                    {displayParameterLinkValue(write.currentValue)}
                  </td>
                  <td className="px-2 py-1 font-mono tabular-nums text-[var(--lichen)]">
                    {displayParameterLinkValue(write.linkedValue)}
                  </td>
                  <td
                    className={`px-2 py-1 font-mono tabular-nums ${
                      write.changed ? "text-[var(--clay-ink)]" : "text-[var(--lichen)]"
                    }`}
                  >
                    {displayParameterLinkValue(write.proposedValue)}
                    {write.overrideApplied ? " (override)" : ""}
                  </td>
                  <td className="px-2 py-1">
                    {write.changed ? (
                      <span className="inline-block size-1.5 rounded-full bg-[var(--pe-blue)]" />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {changed.length === 0 && writes.length > 0 ? (
        <p className="text-[10px] text-[var(--lichen)]">
          Every target already matches its source — Apply is a no-op.
        </p>
      ) : null}
    </div>
  );
}
