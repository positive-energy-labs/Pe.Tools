import { token } from "#/lib/token";
import type {
  RevitDetailParameterLinks,
  RevitMatrixLoadedFamilies,
} from "@pe/host-contracts/generated";
import { EmptyState } from "#/components/lang/empty";
import { Provenance } from "#/components/lang/section";
import { type Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import { KVGrid } from "#/ops/primitives";
import { type OpViewProps, UnrecognizedShape, asRecord } from "#/ops/registry";
import { issueLine } from "./schedules";
import { linkValueText } from "./sheets";

export function ParameterLinksView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !asRecord(rec.status)) return <UnrecognizedShape />;
  const res = rec as unknown as RevitDetailParameterLinks.Res.Response;
  const defs = new Map((res.profile?.definitions ?? []).map((d) => [d.id, d]));
  const writes = res.evaluation?.writes ?? [];
  const issues = res.evaluation?.issues ?? [];
  const issueByTarget = new Map<string, RevitDetailParameterLinks.Res.ParameterLinkIssue>();
  for (const issue of issues) {
    if (issue.targetElementUniqueId) issueByTarget.set(issue.targetElementUniqueId, issue);
  }

  const columns: Column<RevitDetailParameterLinks.Res.ParameterLinkWrite>[] = [
    {
      key: "target",
      label: "target",
      cell: (w) => (
        <span title={w.targetElementUniqueId}>
          {w.targetElementName ?? w.targetElementId} <span className="">{w.targetElementId}</span>
        </span>
      ),
    },
    { key: "parameter", label: "target parameter", cell: (w) => w.targetParameter.name },
    {
      key: "source",
      label: "source",
      cell: (w) => {
        const def = defs.get(w.definitionId);
        if (!def) return <span className="">{w.definitionId}</span>;
        return `${def.sourceParameter.name ?? def.sourceParameter.identity?.name ?? "?"} (${def.relationship}, ${def.reducer})`;
      },
    },
    {
      key: "current",
      label: "current",
      right: true,
      cell: (w) => linkValueText(w.currentValue),
    },
    {
      key: "proposed",
      label: "proposed",
      right: true,
      cell: (w) => (
        <span style={{ color: w.changed ? token("caution") : undefined }}>
          {linkValueText(w.proposedValue)}
        </span>
      ),
    },
    {
      key: "issue",
      label: "issue",
      cell: (w) => {
        const issue = issueByTarget.get(w.targetElementUniqueId);
        return issue ? (
          <span className="" style={{ color: token("caution") }}>
            {issue.code}
          </span>
        ) : (
          ""
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <KVGrid
        columns={3}
        items={[
          { label: "stored profile", value: res.status.hasStoredProfile ? "yes" : "no" },
          { label: "updater registered", value: res.status.updaterRegistered ? "yes" : "no" },
          { label: "definitions", value: res.status.activeDefinitionCount },
          { label: "assignments", value: res.status.activeAssignmentCount },
          {
            label: "proposed changes",
            value: res.evaluation ? res.evaluation.changedWriteCount : "not evaluated",
            tone: (res.evaluation?.changedWriteCount ?? 0) > 0 ? "caution" : undefined,
          },
          {
            label: "issues",
            value: issues.length,
            tone: issues.length > 0 ? "caution" : undefined,
          },
        ]}
      />
      {writes.length > 0 ? (
        <Table
          label="proposed writes"
          caption="proposed writes (nothing applied)"
          maxHeight="28rem"
          columns={columns}
          rows={writes}
          rowKey={(w) => `${w.assignmentId}:${w.targetElementUniqueId}:${w.targetParameter.key}`}
        />
      ) : res.evaluation ? (
        <EmptyState story="scope" exit="every link target already matches its source">
          no proposed writes
        </EmptyState>
      ) : (
        <EmptyState story="scope" exit="request evaluation to see what would be written">
          evaluation not requested
        </EmptyState>
      )}
      {issues
        .filter((i) => !i.targetElementUniqueId)
        .map((issue, i) => (
          <span key={i} className="" style={{ color: token("caution") }}>
            {issue.severity} {issue.code}: {issue.message}
          </span>
        ))}
      {res.evaluation && (
        <Provenance>
          {res.evaluation.sourceElementCount} source · {res.evaluation.targetElementCount} target
          elements evaluated · {res.appliedWriteCount} writes applied this call
        </Provenance>
      )}
    </div>
  );
}

export const MAX_TYPE_COLUMNS = 8;

function FamilyMatrix({ family }: { family: RevitMatrixLoadedFamilies.Res.FamilySnapshotRecord }) {
  const typeNames = family.typeNames.slice(0, MAX_TYPE_COLUMNS);
  const overflow = family.typeNames.length - typeNames.length;
  const columns: Column<RevitMatrixLoadedFamilies.Res.FamilyParameterSnapshot>[] = [
    {
      key: "parameter",
      label: "parameter",
      cell: (p) => (
        <span title={p.definition.identity.key}>
          {p.definition.identity.name}{" "}
          <span className="">
            {p.definition.isInstance == null ? "" : p.definition.isInstance ? "inst" : "type"}
          </span>
        </span>
      ),
    },
    ...typeNames.map((typeName) => ({
      key: `t:${typeName}`,
      label: typeName,
      right: true,
      cell: (p: RevitMatrixLoadedFamilies.Res.FamilyParameterSnapshot) => {
        const value = p.valuesPerType[typeName];
        const hasFormula = p.formulaState === "Present";
        return (
          <span
            className={hasFormula ? "" : undefined}
            title={hasFormula && p.formula ? `= ${p.formula}` : undefined}
          >
            {value ?? "∅"}
          </span>
        );
      },
    })),
  ];
  return (
    <div>
      <Table
        label={family.familyName}
        maxHeight="28rem"
        caption={`${family.familyName}${family.categoryName ? ` — ${family.categoryName}` : ""}`}
        columns={columns}
        rows={family.parameters}
        rowKey={(p) => p.definition.identity.key}
      />
      <Provenance>
        {family.typeNames.length} types
        {overflow > 0 ? ` (${overflow} not shown)` : ""} · {family.placedInstanceCount} placed
        instances
        {family.isPartial ? " · partial snapshot" : ""}
        {family.scheduleNames?.length ? ` · in schedules: ${family.scheduleNames.join(", ")}` : ""}
      </Provenance>
      {family.issues.map((issue, i) => (
        <div key={i}>{issueLine(issue)}</div>
      ))}
    </div>
  );
}

export function LoadedFamiliesView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.families)) return <UnrecognizedShape />;
  const res = rec as unknown as RevitMatrixLoadedFamilies.Res.Response;
  if (res.families.length === 0)
    return (
      <EmptyState story="filter" exit="widen the family filter">
        no families matched
      </EmptyState>
    );

  return (
    <div className="flex flex-col gap-4">
      {res.families.map((family) => (
        <FamilyMatrix key={family.familyUniqueId} family={family} />
      ))}

      {res.issues.slice(0, 5).map((issue, i) => (
        <div key={i}>{issueLine(issue)}</div>
      ))}
      {res.issues.length > 5 && (
        <Provenance>+{res.issues.length - 5} more issues — see raw response</Provenance>
      )}
      {res.page && (
        <Provenance>
          {res.page.returnedCount} of {res.page.totalCount} families
          {res.page.isTruncated ? " · truncated by budget" : ""}
        </Provenance>
      )}
    </div>
  );
}
