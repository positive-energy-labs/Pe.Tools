import type { ReactNode } from "react";
import type {
  FamilyEditorSnapshot,
  RevitDetailElements,
  RevitDetailFamilyModel,
  RevitDetailParameterLinks,
  RevitDetailSchedules,
  RevitDetailSheets,
  RevitMatrixLoadedFamilies,
  RevitMatrixParameterCoverage,
  RevitMatrixScheduleCoverage,
} from "@pe/host-contracts/generated";
import {
  Chip,
  type Column,
  CoverageBar,
  DataTable,
  EmptyState,
  KVGrid,
  MonoNote,
  OpSection,
  Provenance,
  catVar,
} from "#/ops/primitives";
import { type OpViewProps, type OpViewRegistry, asRecord } from "#/ops/registry";

/**
 * Curated readonly detail/matrix views. Each view narrows `data` defensively,
 * then renders the Revit-familiar shape the op reflects — schedule grids,
 * sheet canvases, properties palettes — in the PE design language.
 */

/* ── shared helpers ───────────────────────────────────────────────────────── */

const UNRECOGNIZED = <EmptyState note="unrecognized response shape" />;

function numericish(value: string): boolean {
  const v = value.trim();
  if (v === "") return false;
  return /^-?[\d,]+(\.\d+)?\s*(%|[A-Za-z°"']{0,4})?$/.test(v);
}

/** A column reads numeric when most of its non-empty cells look measured. */
function columnIsNumeric(rows: string[][], columnIndex: number): boolean {
  let nonEmpty = 0;
  let numeric = 0;
  for (const row of rows) {
    const v = row[columnIndex];
    if (v == null || v.trim() === "") continue;
    nonEmpty += 1;
    if (numericish(v)) numeric += 1;
  }
  return nonEmpty > 0 && numeric / nonEmpty >= 0.6;
}

function issueLine(issue: { severity: string; code: string; message: string }): ReactNode {
  return (
    <MonoNote
      hue={issue.severity === "Error" ? "clay" : issue.severity === "Warning" ? "kiln" : undefined}
    >
      {issue.severity.toLowerCase()} {issue.code}: {issue.message}
    </MonoNote>
  );
}

function pageNote(
  page?: { totalCount: number; returnedCount: number; isTruncated: boolean } | null,
): string {
  if (!page) return "";
  return page.isTruncated
    ? ` · truncated: ${page.returnedCount} of ${page.totalCount} returned`
    : ` · ${page.returnedCount} of ${page.totalCount}`;
}

/* ── revit.detail.schedules — the schedule grid itself ────────────────────── */

function SchedulesView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.entries)) return UNRECOGNIZED;
  const res = rec as unknown as RevitDetailSchedules.Res.Response;
  if (res.entries.length === 0) return <EmptyState note="no schedules resolved" />;

  return (
    <div className="flex flex-col gap-4">
      {res.entries.map((entry) => {
        const bodyRows = entry.rows ?? [];
        const values = bodyRows.map((r) => r.values);
        const columns: Column<RevitDetailSchedules.Res.ScheduleRenderedRow>[] = (
          entry.columns ?? []
        ).map((col, colIndex) => ({
          key: col.key || String(col.columnNumber),
          header: col.headerText || col.fieldName,
          numeric: columnIsNumeric(values, colIndex),
          cell: (row) => {
            const v = row.values[colIndex] ?? "";
            return row.kind === "GroupFooter" ? <span className="font-medium">{v}</span> : v;
          },
        }));
        return (
          <div key={entry.scheduleUniqueId}>
            <DataTable
              title={entry.scheduleName}
              columns={columns}
              rows={bodyRows}
              rowKey={(row) => String(row.rowNumber)}
            />
            <Provenance>
              {entry.categoryName ?? "uncategorized"} · {bodyRows.length} of{" "}
              {entry.visibleBodyRowCount} visible rows shown · {entry.subjectCount} subjects
              {entry.isPlacedOnSheet
                ? ` · placed: ${entry.sheetPlacements.map((p) => p.sheetNumber).join(", ")}`
                : " · not placed on a sheet"}
              {entry.isEmpty ? " · schedule is empty" : ""}
            </Provenance>
          </div>
        );
      })}
      {res.issues.map((issue, i) => (
        <div key={i}>{issueLine(issue)}</div>
      ))}
      <Provenance>
        {res.documentTitle} · query {res.queryKind} · {res.resolvedScheduleCount} of{" "}
        {res.requestedScheduleCount} schedules resolved{pageNote(res.page)}
      </Provenance>
    </div>
  );
}

/* ── revit.detail.sheets — sheet as canvas ────────────────────────────────── */

const ANCHOR_HUES = {
  Viewport: "blue",
  ScheduleInstance: "green",
  TextNote: "kiln",
  GenericAnnotation: "lichen",
  RasterImage: "slate",
  ImportInstance: "slate",
  TitleBlock: "slate",
} as const;

export function SheetCanvas({ entry }: { entry: RevitDetailSheets.Res.SheetDetailEntry }) {
  const withBounds = entry.anchors.filter((a) => a.bounds != null);
  const titleBlock = withBounds.find((a) => a.kind === "TitleBlock");
  const frameSource = titleBlock?.bounds ?? null;
  let frame: RevitDetailSheets.Res.SheetBounds;
  if (frameSource) {
    frame = frameSource;
  } else if (withBounds.length > 0) {
    frame = withBounds.reduce(
      (acc, a) => ({
        minX: Math.min(acc.minX, a.bounds?.minX ?? acc.minX),
        minY: Math.min(acc.minY, a.bounds?.minY ?? acc.minY),
        maxX: Math.max(acc.maxX, a.bounds?.maxX ?? acc.maxX),
        maxY: Math.max(acc.maxY, a.bounds?.maxY ?? acc.maxY),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
  } else {
    // No geometry at all — normalized landscape frame just to hold the labels.
    frame = { minX: 0, minY: 0, maxX: 44, maxY: 34 };
  }
  const w = Math.max(frame.maxX - frame.minX, 1e-6);
  const h = Math.max(frame.maxY - frame.minY, 1e-6);
  const pad = Math.max(w, h) * 0.03;
  const fontSize = Math.max(w, h) * 0.016;
  // Sheet coordinates are Y-up; SVG is Y-down.
  const toY = (y: number) => frame.maxY - y;

  return (
    <svg
      viewBox={`${frame.minX - pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`}
      className="block w-full max-w-[720px]"
      role="img"
      aria-label={`sheet ${entry.summary.sheetNumber} anchor map`}
    >
      {/* sheet / titleblock outline */}
      <rect
        x={frame.minX}
        y={0}
        width={w}
        height={h}
        fill="none"
        stroke="var(--line-2)"
        strokeWidth={0.75}
        vectorEffect="non-scaling-stroke"
      />
      {withBounds.map((anchor, i) => {
        if (anchor.kind === "TitleBlock") return null;
        const b = anchor.bounds;
        if (!b) return null;
        const hue = catVar(ANCHOR_HUES[anchor.kind] ?? "slate");
        const bw = Math.max(b.maxX - b.minX, 0);
        const bh = Math.max(b.maxY - b.minY, 0);
        return (
          <g key={`${anchor.handle.uniqueId ?? anchor.handle.elementId ?? i}`}>
            <rect
              x={b.minX}
              y={toY(b.maxY)}
              width={bw}
              height={bh}
              fill={`color-mix(in srgb, ${hue} 10%, transparent)`}
              stroke={`color-mix(in srgb, ${hue} 45%, transparent)`}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {anchor.kind}: {anchor.label}
              </title>
            </rect>
            <text
              x={b.minX + bw * 0.03}
              y={toY(b.maxY) + fontSize * 1.3}
              fontSize={fontSize}
              fill={hue}
              className="font-[var(--font-mono,_monospace)]"
            >
              {anchor.label.length > 28 ? `${anchor.label.slice(0, 27)}…` : anchor.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SheetsView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.sheets)) return UNRECOGNIZED;
  const res = rec as unknown as RevitDetailSheets.Res.Response;
  if (res.sheets.length === 0) return <EmptyState note="no sheets resolved" />;

  return (
    <div className="flex flex-col gap-5">
      {res.sheets.map((entry) => {
        const s = entry.summary;
        const unplaced = entry.anchors.filter((a) => a.bounds == null);
        return (
          <OpSection
            key={s.handle.uniqueId ?? s.sheetNumber}
            label={`${s.sheetNumber} — ${s.sheetName}`}
            aside={
              <>
                <Chip hue="blue">{s.viewportCount} views</Chip>
                <Chip hue="green">{s.scheduleInstanceCount} schedules</Chip>
                <Chip hue="kiln">{s.textNoteCount} notes</Chip>
              </>
            }
          >
            <SheetCanvas entry={entry} />
            {unplaced.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {unplaced.map((a, i) => (
                  <Chip
                    key={i}
                    hue={ANCHOR_HUES[a.kind] ?? "slate"}
                    title={`${a.kind} — no bounding box in response`}
                  >
                    {a.label}
                  </Chip>
                ))}
              </div>
            )}
            {unplaced.length > 0 && (
              <Provenance>
                {unplaced.length} anchors carried no bounding box and are listed, not drawn
              </Provenance>
            )}
            {entry.issues.map((issue, i) => (
              <div key={i}>{issueLine(issue)}</div>
            ))}
          </OpSection>
        );
      })}
      {res.issues.map((issue, i) => (
        <div key={i}>{issueLine(issue)}</div>
      ))}
      <Provenance>
        {res.page.returnedCount} of {res.page.totalCount} sheets
        {res.page.isTruncated ? " · truncated by budget" : ""} · anchor boxes in sheet coordinates
        (units per host)
      </Provenance>
    </div>
  );
}

/* ── revit.detail.elements — properties palette per element ───────────────── */

function ParameterRows({
  label,
  params,
}: {
  label: string;
  params: RevitDetailElements.Res.RequestedElementParameterValue[];
}) {
  if (params.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="section-label mb-1">{label}</div>
      <div className="rounded-[var(--radius)] border border-[var(--line)]">
        {params.map((p) => (
          <div
            key={p.identity.key}
            className="flex items-baseline justify-between gap-3 border-b border-[var(--line-soft)] px-2 py-1"
          >
            <span className="min-w-0 truncate text-xs" title={p.name}>
              {p.name}
            </span>
            <span
              className={`tele shrink-0 text-right ${!p.found || p.isBlank ? "text-cat-kiln" : ""}`}
              title={p.rawValue ?? undefined}
            >
              {!p.found ? "not found" : p.isBlank ? "blank" : (p.displayValue ?? p.value ?? "∅")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ElementCard({ entry }: { entry: RevitDetailElements.Res.ElementContextEntry }) {
  const params = entry.requestedParameters ?? [];
  const instanceParams = params.filter((p) => p.source === "Instance");
  const typeParams = params.filter((p) => p.source === "Type");
  const otherParams = params.filter((p) => p.source !== "Instance" && p.source !== "Type");
  const grouped = instanceParams.length > 0 || typeParams.length > 0;

  return (
    <div className="rounded-[var(--radius)] border border-[var(--line-2)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        {entry.categoryName && <Chip hue="blue">{entry.categoryName}</Chip>}
        <span className="text-xs font-medium">{entry.name}</span>
        {entry.familyName && (
          <span className="text-[11px] text-muted-foreground">
            {entry.familyName}
            {entry.typeName ? ` : ${entry.typeName}` : ""}
          </span>
        )}
        <span className="tele ml-auto text-[10px] text-muted-foreground">{entry.elementId}</span>
      </div>
      {(entry.levelName || entry.mark) && (
        <div className="mt-1.5">
          <KVGrid
            columns={2}
            items={[
              ...(entry.levelName ? [{ label: "level", value: entry.levelName }] : []),
              ...(entry.mark ? [{ label: "mark", value: entry.mark }] : []),
            ]}
          />
        </div>
      )}
      {grouped ? (
        <>
          <ParameterRows label="instance" params={instanceParams} />
          <ParameterRows label="type" params={typeParams} />
          <ParameterRows label="unresolved" params={otherParams} />
        </>
      ) : (
        <ParameterRows label="parameters" params={params} />
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {entry.electrical && <Chip hue="lichen">{entry.electrical.role}</Chip>}
        {entry.circuit && (
          <Chip hue="blue" title={entry.circuit.loadName ?? undefined}>
            ckt {entry.circuit.circuitNumber}
            {entry.circuit.panelName ? ` @ ${entry.circuit.panelName}` : ""}
          </Chip>
        )}
        {entry.panelContext && (
          <Chip hue="green">
            panel {entry.panelContext.panelName} · {entry.panelContext.assignedCircuitCount} ckts
          </Chip>
        )}
        {entry.connectors && entry.connectors.electricalConnectorCount > 0 && (
          <Chip hue="slate">{entry.connectors.electricalConnectorCount} elec connectors</Chip>
        )}
        {entry.panelSchedule && <Chip hue="green">sched {entry.panelSchedule.scheduleName}</Chip>}
        {entry.loadClassification && <Chip hue="kiln">{entry.loadClassification.name}</Chip>}
        {entry.wire && (
          <Chip hue="slate">wire {entry.wire.wireTypeName ?? entry.wire.wiringType}</Chip>
        )}
      </div>
    </div>
  );
}

function ElementsView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.entries)) return UNRECOGNIZED;
  const res = rec as unknown as RevitDetailElements.Res.Response;
  if (res.entries.length === 0) return <EmptyState note="no elements resolved" />;

  return (
    <div className="flex flex-col gap-3">
      {res.entries.map((entry) => (
        <ElementCard key={entry.elementUniqueId} entry={entry} />
      ))}
      {res.issues.map((issue, i) => (
        <div key={i}>{issueLine(issue)}</div>
      ))}
      <Provenance>
        {res.documentTitle} · query {res.queryKind} · {res.resolvedElementCount} of{" "}
        {res.requestedElementCount} elements resolved
      </Provenance>
    </div>
  );
}

/* ── revit.detail.parameter-links — stored profile + proposed writes ──────── */

function linkValueText(
  v: RevitDetailParameterLinks.Res.ParameterLinkValue | null | undefined,
): string {
  if (!v) return "∅";
  return (
    v.displayValue ??
    v.stringValue ??
    (v.doubleValue != null ? String(v.doubleValue) : null) ??
    (v.integerValue != null ? String(v.integerValue) : null) ??
    (v.elementIdValue != null ? String(v.elementIdValue) : null) ??
    "∅"
  );
}

function ParameterLinksView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !asRecord(rec.status)) return UNRECOGNIZED;
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
      header: "target",
      cell: (w) => (
        <span title={w.targetElementUniqueId}>
          {w.targetElementName ?? w.targetElementId}{" "}
          <span className="tele text-[10px] text-muted-foreground">{w.targetElementId}</span>
        </span>
      ),
    },
    { key: "parameter", header: "target parameter", cell: (w) => w.targetParameter.name },
    {
      key: "source",
      header: "source",
      cell: (w) => {
        const def = defs.get(w.definitionId);
        if (!def) return <MonoNote>{w.definitionId}</MonoNote>;
        return `${def.sourceParameter.name ?? def.sourceParameter.identity?.name ?? "?"} (${def.relationship}, ${def.reducer})`;
      },
    },
    {
      key: "current",
      header: "current",
      numeric: true,
      cell: (w) => linkValueText(w.currentValue),
    },
    {
      key: "proposed",
      header: "proposed",
      numeric: true,
      cell: (w) => (
        <span className={w.changed ? "text-cat-green" : undefined}>
          {linkValueText(w.proposedValue)}
        </span>
      ),
    },
    {
      key: "issue",
      header: "issue",
      cell: (w) => {
        const issue = issueByTarget.get(w.targetElementUniqueId);
        return issue ? <MonoNote hue="clay">{issue.code}</MonoNote> : "";
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
            hue: (res.evaluation?.changedWriteCount ?? 0) > 0 ? "green" : undefined,
          },
          { label: "issues", value: issues.length, hue: issues.length > 0 ? "clay" : undefined },
        ]}
      />
      {writes.length > 0 ? (
        <DataTable
          title="proposed writes (nothing applied)"
          columns={columns}
          rows={writes}
          rowKey={(w) => `${w.assignmentId}:${w.targetElementUniqueId}:${w.targetParameter.key}`}
        />
      ) : (
        <EmptyState note={res.evaluation ? "no proposed writes" : "evaluation not requested"} />
      )}
      {issues
        .filter((i) => !i.targetElementUniqueId)
        .map((issue, i) => (
          <MonoNote key={i} hue={issue.severity === "error" ? "clay" : "kiln"}>
            {issue.severity} {issue.code}: {issue.message}
          </MonoNote>
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

/* ── revit.matrix.loaded-families — parameter × type matrix per family ────── */

const MAX_TYPE_COLUMNS = 8;

function FamilyMatrix({ family }: { family: RevitMatrixLoadedFamilies.Res.FamilySnapshotRecord }) {
  const typeNames = family.typeNames.slice(0, MAX_TYPE_COLUMNS);
  const overflow = family.typeNames.length - typeNames.length;
  const columns: Column<RevitMatrixLoadedFamilies.Res.FamilyParameterSnapshot>[] = [
    {
      key: "parameter",
      header: "parameter",
      cell: (p) => (
        <span title={p.definition.identity.key}>
          {p.definition.identity.name}{" "}
          <span className="tele text-[10px] text-muted-foreground">
            {p.definition.isInstance == null ? "" : p.definition.isInstance ? "inst" : "type"}
          </span>
        </span>
      ),
    },
    ...typeNames.map((typeName) => ({
      key: `t:${typeName}`,
      header: typeName,
      numeric: true,
      cell: (p: RevitMatrixLoadedFamilies.Res.FamilyParameterSnapshot) => {
        const value = p.valuesPerType[typeName];
        const hasFormula = p.formulaState === "Present";
        return (
          <span
            className={hasFormula ? "text-cat-lichen" : undefined}
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
      <DataTable
        title={`${family.familyName}${family.categoryName ? ` — ${family.categoryName}` : ""}`}
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

function LoadedFamiliesView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.families)) return UNRECOGNIZED;
  const res = rec as unknown as RevitMatrixLoadedFamilies.Res.Response;
  if (res.families.length === 0) return <EmptyState note="no families matched" />;

  return (
    <div className="flex flex-col gap-4">
      {res.families.map((family) => (
        <FamilyMatrix key={family.familyUniqueId} family={family} />
      ))}
      {/* per-family issues already render inline; the flat list here is capped hard —
          an unfiltered project can carry hundreds of snapshot warnings. */}
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

/* ── revit.matrix.parameter-coverage — CoverageBar per parameter×category ─── */

function ParameterCoverageView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.parameters)) return UNRECOGNIZED;
  const res = rec as unknown as RevitMatrixParameterCoverage.Res.Response;
  if (res.parameters.length === 0) return <EmptyState note="no parameters in scope" />;

  return (
    <div className="flex flex-col gap-4">
      {res.parameters.map((entry) => (
        <div key={`${entry.identity.key}:${entry.categoryName ?? ""}`}>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-xs font-medium">{entry.identity.name}</span>
            {entry.categoryName && <Chip hue="blue">{entry.categoryName}</Chip>}
            <MonoNote>{entry.elementCount} elements</MonoNote>
          </div>
          <CoverageBar
            total={entry.elementCount}
            segments={[
              { label: "present", count: entry.presentCount, hue: "green" },
              { label: "blank", count: entry.blankCount, hue: "kiln" },
              { label: "default", count: entry.defaultCount, hue: "slate" },
            ]}
          />
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

/* ── revit.matrix.schedule-coverage — scheduled vs unscheduled ────────────── */

function ScheduleCoverageView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || typeof rec.totalElements !== "number") return UNRECOGNIZED;
  const res = rec as unknown as RevitMatrixScheduleCoverage.Res.Response;

  return (
    <div className="flex flex-col gap-3">
      <OpSection
        label="schedule coverage"
        aside={<MonoNote>{res.scheduleCount} schedules considered</MonoNote>}
      >
        <CoverageBar
          total={res.totalElements}
          segments={[
            { label: "scheduled", count: res.coveredElements, hue: "green" },
            { label: "unscheduled", count: res.missingElements, hue: "kiln" },
          ]}
        />
      </OpSection>
      {(res.roleSummaries?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {res.roleSummaries?.map((role) => (
            <Chip key={role.role} hue="slate" title={role.scheduleNames.join(", ")}>
              {role.role}: {role.scheduleCount} sched / {role.coveredElementCount} elems
            </Chip>
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

/* ── family.editor.snapshot — family editor state ─────────────────────────── */

function FamilyEditorSnapshotView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.parameters) || typeof rec.familyName !== "string")
    return UNRECOGNIZED;
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
          <span className="tele text-[10px] text-muted-foreground">
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
      cell: (p) => (p.formula ? <span className="tele text-cat-lichen">= {p.formula}</span> : ""),
    },
    ...typeNames.map((typeName) => ({
      key: `t:${typeName}`,
      header:
        typeName === res.currentTypeName ? (
          <span>
            {typeName} <span className="tele text-[10px] text-cat-blue">current</span>
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

/* ── revit.detail.family-model — capture receipt ──────────────────────────── */

function FamilyModelView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || typeof rec.familyName !== "string" || !asRecord(rec.evidence)) return UNRECOGNIZED;
  const res = rec as unknown as RevitDetailFamilyModel.Res.Response;
  const ev = res.evidence;

  return (
    <div className="flex flex-col gap-3">
      <KVGrid
        columns={3}
        items={[
          { label: "family", value: res.familyName },
          {
            label: "unmodeled",
            value: res.unmodeledCount,
            hue: res.unmodeledCount > 0 ? "clay" : undefined,
          },
          { label: "types captured", value: ev.typeNames.length },
          { label: "parameters captured", value: ev.parameters.length },
          { label: "model.json size", value: `${res.modelJson.length} chars` },
        ]}
      />
      {ev.typeNames.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ev.typeNames.map((t) => (
            <Chip key={t} hue="slate">
              {t}
            </Chip>
          ))}
        </div>
      )}
      {ev.diagnostics.length > 0 ? (
        <OpSection label="diagnostics">
          <div className="rounded-[var(--radius)] border border-[var(--line)]">
            {ev.diagnostics.map((d, i) => (
              <div key={i} className="border-b border-[var(--line-soft)] px-2 py-1">
                <MonoNote
                  hue={
                    d.provenance === "Unresolved"
                      ? "clay"
                      : d.provenance === "Inferred"
                        ? "kiln"
                        : undefined
                  }
                >
                  {d.code} @ {d.path}
                  {d.confidence != null ? ` (confidence ${d.confidence})` : ""}
                </MonoNote>
                <div className="text-xs">{d.message}</div>
              </div>
            ))}
          </div>
        </OpSection>
      ) : (
        <Provenance>no capture diagnostics — every parameter resolved exactly</Provenance>
      )}
      <Provenance>
        evidence: {ev.parameters.length} parameters × {ev.typeNames.length} types resolved from the
        family document
      </Provenance>
    </div>
  );
}

/* ── registry ─────────────────────────────────────────────────────────────── */

export const views: OpViewRegistry = {
  "revit.detail.schedules": SchedulesView,
  "revit.detail.sheets": SheetsView,
  "revit.detail.elements": ElementsView,
  "revit.detail.parameter-links": ParameterLinksView,
  "revit.matrix.loaded-families": LoadedFamiliesView,
  "revit.matrix.parameter-coverage": ParameterCoverageView,
  "revit.matrix.schedule-coverage": ScheduleCoverageView,
  "family.editor.snapshot": FamilyEditorSnapshotView,
  "revit.detail.family-model": FamilyModelView,
};
