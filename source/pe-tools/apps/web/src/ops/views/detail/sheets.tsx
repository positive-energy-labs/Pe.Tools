import type { RevitDetailParameterLinks, RevitDetailSheets } from "@pe/host-contracts/generated";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { VizChip } from "#/ops/primitives";
import { type OpViewProps, UnrecognizedShape, asRecord } from "#/ops/registry";
import { ANCHOR_VIZ, SheetCanvas, issueLine } from "./schedules";

export function SheetsView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.sheets)) return <UnrecognizedShape />;
  const res = rec as unknown as RevitDetailSheets.Res.Response;
  if (res.sheets.length === 0)
    return (
      <EmptyState story="filter" exit="widen the sheet reference query">
        no sheets resolved
      </EmptyState>
    );

  return (
    <div className="flex flex-col gap-5">
      {res.sheets.map((entry) => {
        const s = entry.summary;
        const unplaced = entry.anchors.filter((a) => a.bounds == null);
        return (
          <Section
            key={s.handle.uniqueId ?? s.sheetNumber}
            label={`${s.sheetNumber} — ${s.sheetName}`}
            aside={
              <>
                <VizChip viz={1}>{s.viewportCount} views</VizChip>
                <VizChip viz={2}>{s.scheduleInstanceCount} schedules</VizChip>
                <VizChip viz={6}>{s.textNoteCount} notes</VizChip>
              </>
            }
          >
            <SheetCanvas entry={entry} />
            {unplaced.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {unplaced.map((a, i) => (
                  <VizChip
                    key={i}
                    viz={ANCHOR_VIZ[a.kind] ?? 3}
                    title={`${a.kind} — no bounding box in response`}
                  >
                    {a.label}
                  </VizChip>
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
          </Section>
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

export function linkValueText(
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
