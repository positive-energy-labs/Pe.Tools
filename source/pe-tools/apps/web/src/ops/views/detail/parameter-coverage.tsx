import type {
  FamilyEditorSnapshot,
  RevitMatrixParameterCoverage,
  RevitMatrixScheduleCoverage,
} from "@pe/host-contracts/generated";
import { CoverageBar } from "#/components/lang/coverage-bar";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { type Column, DataTable, KVGrid, VizChip } from "#/ops/primitives";
import { type OpViewProps, UnrecognizedShape, asRecord } from "#/ops/registry";
import { MAX_TYPE_COLUMNS } from "./parameter-links";
import { issueLine, pageNote } from "./schedules";

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
            {entry.categoryName && <VizChip viz={1}>{entry.categoryName}</VizChip>}
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
          {entry.samples.length > 0 && (
            <Provenance>
              samples: {entry.samples.map((s) => `${s.displayName} [${s.elementId}]`).join(", ")}
            </Provenance>
          )}
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
            <VizChip key={role.role} viz={3} title={role.scheduleNames.join(", ")}>
              {role.role}: {role.scheduleCount} sched / {role.coveredElementCount} elems
            </VizChip>
          ))}
        </div>
      )}
      {(res.matchedScheduleNames?.length ?? 0) > 0 && (
        <Provenance>matched schedules: {res.matchedScheduleNames?.join(", ")}</Provenance>
      )}
      {(res.missingHandles?.length ?? 0) > 0 && (
        <Provenance>
          unscheduled samples:{" "}
          {res.missingHandles?.map((h) => `${h.displayName} [${h.elementId}]`).join(", ")}
        </Provenance>
      )}
      {res.issues.map((issue, i) => (
        <div key={i}>{issueLine(issue)}</div>
      ))}
      <Provenance>
        {res.totalElements} elements in scope{pageNote(res.page)}
      </Provenance>
    </div>
  );
}

export function FamilyEditorSnapshotView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.parameters) || typeof rec.familyName !== "string")
    return <UnrecognizedShape />;
  const res = rec as unknown as FamilyEditorSnapshot.Res.Response;
  const typeNames = res.typeNames.slice(0, MAX_TYPE_COLUMNS);
  const overflow = res.typeNames.length - typeNames.length;

  const columns: Column<FamilyEditorSnapshot.Res.FamilyEditorParameterSnapshot>[] = [
    {
      key: "name",
      header: "parameter",
      cell: (p) => (
        <span title={p.identity?.key}>
          {p.name}{" "}
          <span className="">
            {p.isInstance ? "inst" : "type"}
            {p.isShared ? " · shared" : ""}
            {p.isReadOnly ? " · ro" : ""}
          </span>
        </span>
      ),
    },
    {
      key: "formula",
      header: "formula",
      cell: (p) => (p.formula ? <span className="">= {p.formula}</span> : ""),
    },
    ...typeNames.map((typeName) => ({
      key: `t:${typeName}`,
      header:
        typeName === res.currentTypeName ? (
          <span>
            {typeName} <span className="">current</span>
          </span>
        ) : (
          typeName
        ),
      numeric: true,
      cell: (p: FamilyEditorSnapshot.Res.FamilyEditorParameterSnapshot) =>
        p.valuesPerType[typeName] ?? "∅",
    })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <KVGrid
        columns={3}
        items={[
          { label: "family", value: res.familyName },
          { label: "current type", value: res.currentTypeName },
          { label: "types", value: res.typeNames.length },
          { label: "parameters", value: res.parameters.length },
        ]}
      />
      <DataTable
        columns={columns}
        rows={res.parameters}
        rowKey={(p) => p.identity?.key ?? p.name}
      />
      {overflow > 0 && <Provenance>{overflow} type columns not shown</Provenance>}
    </div>
  );
}
