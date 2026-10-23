import type {
  RevitMatrixParameterCoverage,
  RevitMatrixScheduleCoverage,
} from "@pe/host-contracts/generated";
import { CoverageBar } from "@pe/kit/lang/coverage-bar";
import { EmptyState } from "@pe/kit/lang/empty";
import { Provenance, Section } from "@pe/kit/lang/section";
import { FactChip } from "@pe/kit/lang/chip";
import { SubjectText, SubjectTextContext } from "@pe/kit/lang/subject-text";
import { useRevitSubjectProps } from "#/revit/element-menu";
import { type OpViewProps, UnrecognizedShape, asRecord } from "#/ops/registry";
import { issueLine, pageNote } from "./schedules";

/**
 * Sample elements as named Subjects (I1): each by its Revit name with a footnote, never its id,
 * and each answers right-click with Selection Box and Select in the document the op read.
 */
function Samples({
  label,
  handles,
}: {
  label: string;
  handles: readonly { elementId: number; displayName: string }[];
}) {
  const refProps = useRevitSubjectProps();
  const names = new Map(handles.map((h) => [h.elementId, h.displayName]));
  return (
    <SubjectTextContext value={{ nameOf: (id) => names.get(id) ?? null, refProps }}>
      <Provenance>
        {label}:{" "}
        <SubjectText
          text={handles.flatMap((h, i) =>
            i ? [", ", { id: h.elementId }] : [{ id: h.elementId }],
          )}
        />
      </Provenance>
    </SubjectTextContext>
  );
}

export function ParameterCoverageView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.parameters)) return <UnrecognizedShape />;
  const res = rec as unknown as RevitMatrixParameterCoverage.Res.Response;
  if (res.parameters.length === 0)
    return (
      <EmptyState story="filter" exit="widen the parameter or category scope">
        no parameters in scope
      </EmptyState>
    );

  return (
    <div className="flex flex-col gap-4">
      {res.parameters.map((entry) => (
        <div key={`${entry.identity.key}:${entry.categoryName ?? ""}`}>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="">{entry.identity.name}</span>
            {entry.categoryName && <FactChip title="category">{entry.categoryName}</FactChip>}
            <span className="">{entry.elementCount} elements</span>
          </div>
          {entry.elementCount > 0 ? (
            <CoverageBar
              total={entry.elementCount}
              segments={[
                { label: "present", count: entry.presentCount, viz: 2 },
                { label: "blank", count: entry.blankCount, viz: 6 },
                { label: "default", count: entry.defaultCount, viz: 3 },
              ]}
            />
          ) : (
            <EmptyState story="scope" exit="no elements carry this parameter — widen the scope">
              nothing to measure
            </EmptyState>
          )}
          {entry.samples.length > 0 && <Samples label="samples" handles={entry.samples} />}
          {entry.missingCount > 0 && (
            <Provenance>
              {entry.missingCount} elements lack the parameter entirely (unaccounted band)
            </Provenance>
          )}
        </div>
      ))}
      {res.issues.map((issue, i) => (
        <div key={i}>{issueLine(issue)}</div>
      ))}
      <Provenance>
        {res.totalElements} elements in scope{pageNote(res.page)}
      </Provenance>
    </div>
  );
}

export function ScheduleCoverageView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || typeof rec.totalElements !== "number") return <UnrecognizedShape />;
  const res = rec as unknown as RevitMatrixScheduleCoverage.Res.Response;

  return (
    <div className="flex flex-col gap-3">
      <Section
        label="schedule coverage"
        aside={<span>{res.scheduleCount} schedules considered</span>}
      >
        {res.totalElements > 0 ? (
          <CoverageBar
            total={res.totalElements}
            segments={[
              { label: "scheduled", count: res.coveredElements, viz: 2 },
              { label: "unscheduled", count: res.missingElements, viz: 6 },
            ]}
          />
        ) : (
          <EmptyState story="scope" exit="widen the category scope, or model something first">
            no elements in scope
          </EmptyState>
        )}
      </Section>
      {(res.roleSummaries?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {res.roleSummaries?.map((role) => (
            <FactChip key={role.role} title={role.scheduleNames.join(", ")}>
              {role.role}: {role.scheduleCount} sched / {role.coveredElementCount} elems
            </FactChip>
          ))}
        </div>
      )}
      {(res.matchedScheduleNames?.length ?? 0) > 0 && (
        <Provenance>matched schedules: {res.matchedScheduleNames?.join(", ")}</Provenance>
      )}
      {res.missingHandles?.length ? (
        <Samples label="unscheduled samples" handles={res.missingHandles} />
      ) : null}
      {res.issues.map((issue, i) => (
        <div key={i}>{issueLine(issue)}</div>
      ))}
      <Provenance>
        {res.totalElements} elements in scope{pageNote(res.page)}
      </Provenance>
    </div>
  );
}
