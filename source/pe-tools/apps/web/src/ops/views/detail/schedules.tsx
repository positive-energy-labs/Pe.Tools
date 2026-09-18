import { token } from "#/lib/token";
import type { ReactNode } from "react";
import type { RevitDetailSchedules, RevitDetailSheets } from "@pe/host-contracts/generated";
import { EmptyState } from "#/components/lang/empty";
import { Provenance } from "#/components/lang/section";
import { type Column, DataTable, type VizIndex, vizVar } from "#/ops/primitives";
import { type OpViewProps, UnrecognizedShape, asRecord } from "#/ops/registry";
import { contentViewport, fitFrame } from "#/lib/affine-frame";

function numericish(value: string): boolean {
  const v = value.trim();
  if (v === "") return false;
  return /^-?[\d,]+(\.\d+)?\s*(%|[A-Za-z°"']{0,4})?$/.test(v);
}

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

export function issueLine(issue: { severity: string; code: string; message: string }): ReactNode {
  return (
    <span
      className=""
      style={{ color: issue.severity === "Info" ? token("ink-2") : token("caution") }}
    >
      {issue.severity.toLowerCase()} {issue.code}: {issue.message}
    </span>
  );
}

export function pageNote(
  page?: { totalCount: number; returnedCount: number; isTruncated: boolean } | null,
): string {
  if (!page) return "";
  return page.isTruncated
    ? ` · truncated: ${page.returnedCount} of ${page.totalCount} returned`
    : ` · ${page.returnedCount} of ${page.totalCount}`;
}

export function SchedulesView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.entries)) return <UnrecognizedShape />;
  const res = rec as unknown as RevitDetailSchedules.Res.Response;
  if (res.entries.length === 0)
    return (
      <EmptyState story="filter" exit="widen the schedule reference query">
        no schedules resolved
      </EmptyState>
    );

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
            return row.kind === "GroupFooter" ? <span className="">{v}</span> : v;
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

export const ANCHOR_VIZ: Record<string, VizIndex> = {
  Viewport: 1,
  ScheduleInstance: 2,
  TextNote: 6,
  GenericAnnotation: 4,
  RasterImage: 3,
  ImportInstance: 3,
  TitleBlock: 3,
};

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
    frame = { minX: 0, minY: 0, maxX: 44, maxY: 34 };
  }
  const w = Math.max(frame.maxX - frame.minX, 1e-6);
  const h = Math.max(frame.maxY - frame.minY, 1e-6);
  const fontSize = Math.max(w, h) * 0.016;
  const sheet = { minX: frame.minX, minY: frame.minY, maxX: frame.minX + w, maxY: frame.minY + h };
  const { viewport, padding } = contentViewport(sheet, 0.03);
  const camera = fitFrame(sheet, viewport, { padding, yAxis: "up" });
  const [sheetX, sheetY] = camera.toViewport([frame.minX, frame.minY + h]);

  return (
    <svg
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      className="block w-full max-w-[720px]"
      role="img"
      aria-label={`sheet ${entry.summary.sheetNumber} anchor map`}
    >
      <rect
        x={sheetX}
        y={sheetY}
        width={w}
        height={h}
        fill="none"
        stroke={token("line-2")}
        strokeWidth={0.75}
        vectorEffect="non-scaling-stroke"
      />
      {withBounds.map((anchor, i) => {
        if (anchor.kind === "TitleBlock") return null;
        const b = anchor.bounds;
        if (!b) return null;
        const hue = vizVar(ANCHOR_VIZ[anchor.kind] ?? 3);
        const bw = Math.max(b.maxX - b.minX, 0);
        const bh = Math.max(b.maxY - b.minY, 0);
        const [x, y] = camera.toViewport([b.minX, b.maxY]);
        return (
          <g key={`${anchor.handle.uniqueId ?? anchor.handle.elementId ?? i}`}>
            <rect
              x={x}
              y={y}
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
              x={x + bw * 0.03}
              y={y + fontSize * 1.3}
              fontSize={fontSize}
              fill={hue}
              className=""
            >
              {anchor.label.length > 28 ? `${anchor.label.slice(0, 27)}…` : anchor.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
