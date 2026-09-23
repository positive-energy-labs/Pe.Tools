import type {
  ParameterLinkEvaluation,
  ParameterLinkValue,
  ParameterLinksRuntimeStatus,
} from "@pe/agent-contracts";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import type { Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { useTableState } from "#/components/master-table/view";

type Write = ParameterLinkEvaluation["writes"][number];
const CELL = "block truncate px-(--item-pad-x)";
const parameterName = (write: Write) => write.targetParameter.name ?? write.targetParameter.kind;
const targetName = (write: Write) => String(write.targetElementName ?? write.targetElementId);

const WRITE_COLUMNS: Column<Write>[] = [
  {
    key: "target",
    label: "target",
    width: "w-56",
    sort: targetName,
    search: targetName,
    cell: (write) => <span className={CELL}>{targetName(write)}</span>,
  },
  {
    key: "parameter",
    label: "parameter",
    sort: parameterName,
    facet: parameterName,
    search: parameterName,
    cell: (write) => <span className={CELL}>{parameterName(write)}</span>,
  },
  {
    key: "current",
    label: "current",
    cell: (write) => <span className={CELL}>{displayParameterLinkValue(write.currentValue)}</span>,
  },
  {
    key: "linked",
    label: "linked",
    cell: (write) => <span className={CELL}>{displayParameterLinkValue(write.linkedValue)}</span>,
  },
  {
    key: "result",
    label: "result",
    title: "The value apply would write; `changed` rows differ from the current value.",
    facet: (write) => (write.changed ? "changed" : "same"),
    cell: (write) => (
      <span className={CELL}>
        {displayParameterLinkValue(write.proposedValue)}
        {write.overrideApplied ? " (override)" : ""}
      </span>
    ),
  },
];

const writeKey = (write: Write) =>
  `${write.assignmentId}:${write.targetElementUniqueId}:${parameterName(write)}`;

function WritesTable({ writes }: { writes: Write[] }) {
  const [state, setState] = useTableState();
  return (
    <TableFrame
      label="projected writes"
      rows={writes}
      columns={WRITE_COLUMNS}
      rowKey={writeKey}
      state={state}
      onStateChange={setState}
      searchPlaceholder="search targets"
    >
      <Table
        rows={writes}
        columns={WRITE_COLUMNS}
        rowKey={writeKey}
        label="projected writes"
        state={state}
        onStateChange={setState}
      />
    </TableFrame>
  );
}

function displayParameterLinkValue(value: ParameterLinkValue): string {
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
        <WritesTable writes={writes} />
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
