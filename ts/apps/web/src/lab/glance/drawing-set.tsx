import { useEffect, useMemo, useState } from "react";
import type { RevitDetailSheets } from "@pe/host-contracts/generated";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Provenance, Section } from "#/components/lang/section";
import { VizChip } from "#/ops/primitives";
import { asNumber, asRecord, asRecords, asString } from "#/ops/registry";
import type { SyntheticOp, SyntheticViewProps } from "#/lab/synthetic";
import { SheetCanvas } from "#/ops/views/detail/schedules";
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";

const DETAIL_BUDGET = 10;

type SheetListing = {
  sheetNumber: string;
  sheetName: string;
  uniqueId?: string;
  placedViewCount: number;
  placedScheduleCount: number;
};

type Series = { prefix: string; sheets: SheetListing[] };

function seriesPrefix(sheetNumber: string): string {
  const m = /^[^\d]+/.exec(sheetNumber.trim());
  return m ? m[0] : sheetNumber.trim() || "?";
}

function narrowSheetList(indexResult: unknown): { sheets: SheetListing[]; total?: number } {
  const rec = asRecord(indexResult);
  if (!rec) return { sheets: [] };
  const summary = asRecord(rec.summary);
  const sheets = asRecords(rec.sheets).flatMap((s) => {
    const sheetNumber = asString(s.sheetNumber);
    const sheetName = asString(s.sheetName);
    if (sheetNumber == null || sheetName == null) return [];
    return [
      {
        sheetNumber,
        sheetName,
        uniqueId: asString(asRecord(s.handle)?.uniqueId),
        placedViewCount: asNumber(s.placedViewCount) ?? 0,
        placedScheduleCount: asNumber(s.placedScheduleCount) ?? 0,
      },
    ];
  });
  return { sheets, total: asNumber(summary?.sheetCount) };
}

function groupBySeries(sheets: SheetListing[]): Series[] {
  const order: string[] = [];
  const byPrefix = new Map<string, SheetListing[]>();
  for (const sheet of sheets) {
    const prefix = seriesPrefix(sheet.sheetNumber);
    if (!byPrefix.has(prefix)) {
      byPrefix.set(prefix, []);
      order.push(prefix);
    }
    byPrefix.get(prefix)?.push(sheet);
  }
  return order.map((prefix) => ({ prefix, sheets: byPrefix.get(prefix) ?? [] }));
}

function chooseDetailTargets(series: Series[]): string[] {
  const richness = (s: SheetListing) => s.placedViewCount + s.placedScheduleCount;
  const chosen: string[] = [];
  for (const group of series) {
    if (chosen.length >= DETAIL_BUDGET) break;
    const best = [...group.sheets].sort((a, b) => richness(b) - richness(a))[0];
    if (best) chosen.push(best.sheetNumber);
  }
  const rest = series
    .flatMap((g) => g.sheets)
    .filter((s) => !chosen.includes(s.sheetNumber))
    .sort((a, b) => richness(b) - richness(a));
  for (const sheet of rest) {
    if (chosen.length >= DETAIL_BUDGET) break;
    chosen.push(sheet.sheetNumber);
  }
  return chosen;
}

function EmptyFrame() {
  return (
    <div className="aspect-[3/2]">
      <EmptyState story="scope" exit="open a sheet inside the detail budget">
        not detailed
      </EmptyState>
    </div>
  );
}

// DOMAIN (kept off the one List): a sheet-tile gallery; its layout is the point, not a list item.
function Thumbnail({
  sheet,
  entry,
  selected,
  onSelect,
}: {
  sheet: SheetListing;
  entry?: RevitDetailSheets.Res.SheetDetailEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Press
      type="button"
      tone="neutral"
      state={selected ? "selected" : "rest"}
      onClick={onSelect}
      title={
        entry
          ? `${sheet.sheetNumber} — ${sheet.sheetName}`
          : `${sheet.sheetNumber} — ${sheet.sheetName} (not detailed: outside the ${DETAIL_BUDGET}-sheet budget)`
      }
    >
      <PressContent geometry="stack">
        {entry ? <SheetCanvas entry={entry} /> : <EmptyFrame />}
        <span className="truncate">{sheet.sheetNumber}</span>
        {entry && <span className="truncate">{sheet.sheetName}</span>}
      </PressContent>
    </Press>
  );
}

function DrawingSetView({ results, observedAtMs, call }: SyntheticViewProps) {
  const { sheets, total } = useMemo(
    () => narrowSheetList(results["revit.catalog.project-index"]),
    [results],
  );
  const series = useMemo(() => groupBySeries(sheets), [sheets]);
  const targets = useMemo(() => chooseDetailTargets(series), [series]);

  const [details, setDetails] = useState<Map<string, RevitDetailSheets.Res.SheetDetailEntry>>();
  const [detailError, setDetailError] = useState<string>();
  const [selected, setSelected] = useState<string>();

  useEffect(() => {
    if (targets.length === 0) return;
    let cancelled = false;
    setDetails(undefined);
    setDetailError(undefined);
    void call("revit.detail.sheets", {
      references: { sheetNumbers: targets },
      projection: {
        view: "Anchors",
        includeTitleBlocks: true,
        includeViewports: true,
        includeScheduleInstances: true,
        includeTextNotes: true,
        includeBoundingBoxes: true,
      },
      budget: { maxEntries: targets.length, maxSamplesPerEntry: 80 },
    }).then(
      (data) => {
        if (cancelled) return;
        const rec = asRecord(data);
        if (!rec || !Array.isArray(rec.sheets)) {
          setDetailError("unrecognized revit.detail.sheets response shape");
          return;
        }
        const res = rec as unknown as RevitDetailSheets.Res.Response;
        setDetails(new Map(res.sheets.map((entry) => [entry.summary.sheetNumber, entry])));
      },
      (error: unknown) => {
        if (!cancelled) setDetailError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [targets, call]);

  if (sheets.length === 0)
    return (
      <EmptyState story="scope" exit="create sheets in the project first">
        no sheets in the project index
      </EmptyState>
    );

  const selectedSheet = sheets.find((s) => s.sheetNumber === selected);
  const selectedEntry = selected != null ? details?.get(selected) : undefined;

  return (
    <div className="flex flex-col gap-4">
      {series.map((group) => (
        <Section
          key={group.prefix}
          label={`${group.prefix} series`}
          aside={<span>{group.sheets.length} sheets</span>}
        >
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
            {group.sheets.map((sheet) => (
              <Thumbnail
                key={sheet.uniqueId ?? sheet.sheetNumber}
                sheet={sheet}
                entry={details?.get(sheet.sheetNumber)}
                selected={selected === sheet.sheetNumber}
                onSelect={() => setSelected(sheet.sheetNumber)}
              />
            ))}
          </div>
        </Section>
      ))}

      {selectedSheet ? (
        <Section
          label={`${selectedSheet.sheetNumber} — ${selectedSheet.sheetName}`}
          aside={
            selectedEntry ? (
              <>
                <VizChip viz={1}>{selectedEntry.summary.viewportCount} views</VizChip>
                <VizChip viz={2}>{selectedEntry.summary.scheduleInstanceCount} schedules</VizChip>
                <VizChip viz={6}>{selectedEntry.summary.textNoteCount} notes</VizChip>
              </>
            ) : undefined
          }
        >
          {selectedEntry ? (
            <SheetCanvas entry={selectedEntry} />
          ) : (
            <EmptyState
              story="scope"
              exit={`raise the ${DETAIL_BUDGET}-sheet anchor budget, or pick a detailed sheet`}
            >
              {selectedSheet.sheetNumber} was not detailed
            </EmptyState>
          )}
        </Section>
      ) : (
        <EmptyState story="scope" exit="select a thumbnail to enlarge its anchor map">
          no sheet selected
        </EmptyState>
      )}

      {detailError && (
        <OutcomeLine kind="error" label="revit.detail.sheets failed" says={detailError} />
      )}
      <Provenance>
        {details ? details.size : detailError ? 0 : "…"} of {total ?? sheets.length} sheets detailed
        (anchor geometry; budget {DETAIL_BUDGET}, one per series then richest remainder) · remaining
        sheets render as empty frames · obs{" "}
        {observedAtMs ? new Date(observedAtMs).toLocaleTimeString() : "—"}
      </Provenance>
    </div>
  );
}

export const drawingSetOps: SyntheticOp[] = [
  {
    key: "glance.drawing-set",
    displayName: "The drawing set",
    blurb: "what this project's deliverable looks like — the wall of sheets pinned up by series",
    contractNote:
      "wants revit.catalog.sheets: flat sheet list with series grouping + per-sheet anchor thumbnails in one bounded call; today it takes project-index (Sheets) + a staged N-sheet detail.sheets batch",
    deps: [
      {
        key: "revit.catalog.project-index",
        request: {
          sections: ["Sheets"],
          projection: { view: "Handles" },
          budget: { maxEntries: 100, maxSamplesPerEntry: 10 },
        },
      },
    ],
    View: DrawingSetView,
  },
];
