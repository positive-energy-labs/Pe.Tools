import { token } from "#/lib/token";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { type Column, DataTable } from "#/ops/primitives";
import {
  asNumber,
  asRecord,
  asRecords,
  asString,
  type OpViewProps,
  type OpViewRegistry,
  UnrecognizedShape,
} from "#/ops/registry";
import type { Rec } from "./record";
import type { BreakerSlot } from "./circuits";
import { IssuesNote, MonoAside, PanelsView, joinNonEmpty } from "./record";
import { CircuitsView, LoadClassificationsView, extractBreakerSlots } from "./circuits";

export function BreakerHalf({
  slot,
  side,
}: {
  slot: BreakerSlot | undefined;
  side: "left" | "right";
}) {
  const gutter = (
    <span
      className={`w-[34px] shrink-0 px-1.5 py-1 ${side === "left" ? "text-right" : "text-left"}`}
    >
      {slot?.num ?? ""}
    </span>
  );
  const facts = slot && (slot.trip || slot.poles) && (
    <span className="shrink-0 px-1">
      {joinNonEmpty([slot.trip, slot.poles ? `${slot.poles}P` : undefined], "/")}
    </span>
  );
  const load = (
    <span
      className={`min-w-0 flex-1 truncate px-1.5 py-1 ${side === "right" ? "text-right" : ""}`}
      title={slot?.load}
    >
      {slot ? (slot.load ?? <span className="">—</span>) : ""}
    </span>
  );
  const inner =
    side === "left" ? (
      <>
        {gutter}
        {load}
        {facts}
      </>
    ) : (
      <>
        {facts}
        {load}
        {gutter}
      </>
    );
  return <div className={`flex min-w-0 items-center ${side === "left" ? "" : ""}`}>{inner}</div>;
}

export function Panelboard({ slots }: { slots: BreakerSlot[] }) {
  const odds = slots.filter((s) => s.num % 2 === 1).sort((a, b) => a.num - b.num);
  const evens = slots.filter((s) => s.num % 2 === 0).sort((a, b) => a.num - b.num);
  const rowCount = Math.max(odds.length, evens.length);
  return (
    <div>
      {Array.from({ length: rowCount }, (_, i) => (
        <div key={i} className={`grid grid-cols-2 ${i > 0 ? "" : ""}`}>
          <BreakerHalf slot={odds[i]} side="left" />
          <BreakerHalf slot={evens[i]} side="right" />
        </div>
      ))}
    </div>
  );
}

export function SectionGrid({ section }: { section: Rec }) {
  const rows = asRecords(section.rows);
  if (rows.length === 0) return null;
  const columnNumbers = [
    ...new Set(
      rows.flatMap((row) => asRecords(row.cells).map((cell) => asNumber(cell.columnNumber) ?? 0)),
    ),
  ].sort((a, b) => a - b);
  const headers = new Map<number, string>();
  for (const row of rows) {
    for (const cell of asRecords(row.cells)) {
      const col = asNumber(cell.columnNumber);
      const header = asString(cell.columnHeaderText);
      if (col !== undefined && header && !headers.has(col)) headers.set(col, header);
    }
  }
  const columns: Column<Rec>[] = columnNumbers.map((col) => ({
    key: String(col),
    header: headers.get(col) ?? `c${col}`,
    cell: (row) => {
      const cell = asRecords(row.cells).find((c) => asNumber(c.columnNumber) === col);
      return cell && cell.isBlank !== true ? (asString(cell.displayText) ?? "") : "";
    },
  }));
  return (
    <DataTable<Rec>
      columns={columns}
      rows={rows}
      rowKey={(row, i) => String(asNumber(row.rowNumber) ?? i)}
      maxHeight="36rem"
    />
  );
}

export function SectionLines({ section }: { section: Rec }) {
  const lines = asRecords(section.rows)
    .map((row) =>
      asRecords(row.cells)
        .filter(
          (cell) => cell.isBlank !== true && (asString(cell.displayText)?.trim() ?? "") !== "",
        )
        .map((cell) => asString(cell.displayText)?.trim())
        .join("  "),
    )
    .filter((line) => line !== "");
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5">
      {lines.map((line, i) => (
        <MonoAside key={i}>{line}</MonoAside>
      ))}
    </div>
  );
}

export function PanelScheduleCard({ entry }: { entry: Rec }) {
  const sections = asRecords(entry.sections);
  const header = sections.find((s) => asString(s.sectionType) === "Header");
  const body = sections.find((s) => asString(s.sectionType) === "Body");
  const summary = sections.find((s) => asString(s.sectionType) === "Summary");
  const footer = sections.find((s) => asString(s.sectionType) === "Footer");
  const slots = body ? extractBreakerSlots(body) : undefined;
  const panelName = asString(entry.panelName) ?? asString(entry.scheduleName) ?? "(unnamed panel)";
  return (
    <article className="min-w-0">
      <div
        className="flex items-baseline justify-between gap-2 px-2 py-1.5"
        style={
          { backgroundColor: token("recess"), "--pe-on": token("recess") } as React.CSSProperties
        }
      >
        <h3 className="truncate" title={panelName}>
          {panelName}
        </h3>
        <MonoAside>
          {joinNonEmpty([
            asString(entry.scheduleName),
            asString(entry.templateName),
            asString(entry.panelScheduleType),
          ])}
        </MonoAside>
      </div>
      {header && <SectionLines section={header} />}
      {body ? (
        slots ? (
          <div className={header ? "" : undefined}>
            <Panelboard slots={slots} />
          </div>
        ) : (
          <div className="p-1.5">
            <MonoAside>odd/even reconstruction unavailable — faithful grid</MonoAside>
            <div className="mt-1">
              <SectionGrid section={body} />
            </div>
          </div>
        )
      ) : (
        <div className="px-2 py-2">
          <EmptyState story="scope" exit="request the Body section in the projection">
            no body section in projection
          </EmptyState>
        </div>
      )}
      {summary && (
        <div className="">
          <SectionLines section={summary} />
        </div>
      )}
      {footer && (
        <div className="">
          <SectionLines section={footer} />
        </div>
      )}
    </article>
  );
}

export function PanelSchedulesView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const entries = asRecords(record.entries);
  const requested = asNumber(record.requestedScheduleCount);
  const resolved = asNumber(record.resolvedScheduleCount);
  return (
    <Section label="Panel schedules" aside={<MonoAside>{entries.length} schedules</MonoAside>}>
      {entries.length === 0 ? (
        <EmptyState story="filter" exit="widen the schedule reference query">
          no panel schedules resolved
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry, i) => (
            <PanelScheduleCard key={asString(entry.scheduleUniqueId) ?? i} entry={entry} />
          ))}
        </div>
      )}
      <Provenance>
        {joinNonEmpty([
          asString(record.documentTitle) ? `doc ${asString(record.documentTitle)}` : undefined,
          asString(record.queryKind) ? `query ${asString(record.queryKind)}` : undefined,
          requested !== undefined && resolved !== undefined
            ? `resolved ${resolved} of ${requested} requested`
            : undefined,
        ])}
      </Provenance>
      <IssuesNote data={record} />
    </Section>
  );
}

export const views: OpViewRegistry = {
  "revit.catalog.electrical-panels": PanelsView,
  "revit.catalog.electrical-circuits": CircuitsView,
  "revit.catalog.electrical-load-classifications": LoadClassificationsView,
  "revit.detail.electrical-panel-schedules": PanelSchedulesView,
};
