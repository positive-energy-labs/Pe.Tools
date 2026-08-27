import type { ReactNode } from "react";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { type Column, DataTable, KVGrid, VizChip } from "#/ops/primitives";
import {
  asNumber,
  asRecord,
  asRecords,
  asString,
  type OpViewProps,
  type OpViewRegistry,
  UnrecognizedShape,
} from "#/ops/registry";

/**
 * Readonly electrical views: panels, circuits, load classifications, and the
 * panel-schedule panelboard. Shapes mirror RevitBridgeOps electrical contracts.
 */

type Rec = Record<string, unknown>;

/* ── shared fragments ─────────────────────────────────────────────────────── */

function joinNonEmpty(parts: (string | undefined)[], sep = " · "): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(sep);
}

function MonoAside({ children }: { children: ReactNode }) {
  return <span className="face-mono t-caption text-ink-2">{children}</span>;
}

/** Severity is STATE — caution ink, never alarm (not the model disagreeing). */
function IssuesNote({ data }: { data: Rec }) {
  const issues = asRecords(data.issues);
  if (issues.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {issues.map((issue, i) => {
        const severity = asString(issue.severity) ?? "Info";
        return (
          <span
            key={i}
            className="face-mono t-caption"
            style={{ color: severity === "Info" ? "var(--r-ink-2)" : "var(--r-caution)" }}
          >
            {severity.toLowerCase()}: {asString(issue.code)} — {asString(issue.message)}
          </span>
        );
      })}
    </div>
  );
}

/** Echo of ElectricalCatalogFilterReport — what was filtered, what matched. */
function FilterProvenance({ data }: { data: Rec }) {
  const report = asRecord(data.filterReport);
  if (!report) return null;
  const list = (key: string, label: string): string | undefined => {
    const raw = report[key];
    const items = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
    return items.length > 0 ? `${label}=[${items.join(", ")}]` : undefined;
  };
  const before = asNumber(report.candidateCountBeforeFilter);
  const matched = asNumber(report.matchedCount);
  return (
    <Provenance>
      {joinNonEmpty([
        matched !== undefined && before !== undefined
          ? `matched ${matched} of ${before} candidates`
          : undefined,
        list("appliedPanelNames", "panels"),
        list("appliedCircuitNumbers", "circuits"),
        list("appliedLoadNames", "loads"),
        list("appliedMarks", "marks"),
        list("ignoredBlankFilterValues", "ignored-blank"),
      ])}
    </Provenance>
  );
}

/* ── revit.catalog.electrical-panels ──────────────────────────────────────── */

function PanelsView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const entries = asRecords(record.entries);
  return (
    <Section label="Electrical panels" aside={<MonoAside>{entries.length} panels</MonoAside>}>
      {entries.length === 0 ? (
        <EmptyState story="filter" exit="widen the panel filter, or check the model has panels">
          no panels in scope
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">
          {entries.map((panel, i) => {
            const configured = asNumber(panel.configuredSlotCount);
            const occupied = asNumber(panel.occupiedSlotCount);
            const available = asNumber(panel.availableSlotCount);
            const slots = joinNonEmpty(
              [
                occupied !== undefined ? `${occupied} occupied` : undefined,
                configured !== undefined ? `${configured} configured` : undefined,
                available !== undefined ? `${available} free` : undefined,
              ],
              " / ",
            );
            return (
              <article
                key={asString(panel.panelUniqueId) ?? i}
                className="min-w-0 rounded-md border border-line p-2"
              >
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <h3 className="face-mono t-value truncate" title={asString(panel.panelName)}>
                    {asString(panel.panelName) ?? "(unnamed)"}
                  </h3>
                  {asString(panel.mark) && (
                    <FactChip title="panel mark">{asString(panel.mark)}</FactChip>
                  )}
                </div>
                <KVGrid
                  columns={2}
                  items={[
                    { label: "distribution", value: asString(panel.distributionSystemName) ?? "∅" },
                    {
                      label: "type",
                      value:
                        joinNonEmpty(
                          [asString(panel.familyName), asString(panel.typeName)],
                          " / ",
                        ) || "∅",
                    },
                    { label: "role", value: asString(panel.role) ?? "∅" },
                    { label: "slots", value: slots || "∅" },
                  ]}
                />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <VizChip viz={3}>{asNumber(panel.assignedCircuitCount) ?? 0} circuits</VizChip>
                  <VizChip viz={2}>{asNumber(panel.panelScheduleCount) ?? 0} schedules</VizChip>
                  <VizChip viz={4}>{asNumber(panel.connectedLoadCount) ?? 0} loads</VizChip>
                  {panel.isOperationalPanel === false && (
                    <FactChip tone="caution" title="panel is not operational">
                      non-operational
                    </FactChip>
                  )}
                </div>
                <Provenance>
                  id {asNumber(panel.panelId)} · capacity via{" "}
                  {asString(panel.capacitySource) ?? "None"}
                </Provenance>
              </article>
            );
          })}
        </div>
      )}
      <FilterProvenance data={record} />
      <IssuesNote data={record} />
    </Section>
  );
}

/* ── revit.catalog.electrical-circuits ────────────────────────────────────── */

function circuitSortKey(entry: Rec): number {
  const n = Number.parseInt(asString(entry.circuitNumber) ?? "", 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function CircuitsView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const entries = asRecords(record.entries);
  const byPanel = new Map<string, Rec[]>();
  for (const entry of entries) {
    const panel = asString(entry.panelName) ?? "(unassigned)";
    const bucket = byPanel.get(panel);
    if (bucket) bucket.push(entry);
    else byPanel.set(panel, [entry]);
  }
  const panels = [...byPanel.keys()].sort((a, b) => a.localeCompare(b));

  const columns: Column<Rec>[] = [
    {
      key: "ckt",
      header: "CKT",
      numeric: true,
      width: 44,
      cell: (row) => asString(row.circuitNumber) ?? "∅",
    },
    {
      key: "load",
      header: "Load name",
      cell: (row) => (
        <span title={asString(row.loadName)}>
          {asString(row.loadName) ??
            (row.isEmpty === true ? (
              <span className="face-mono t-caption italic text-ink-mute">spare/space</span>
            ) : (
              "∅"
            ))}
        </span>
      ),
    },
    {
      key: "poles",
      header: "Poles",
      numeric: true,
      width: 48,
      cell: (row) => asNumber(row.polesNumber) ?? "∅",
    },
    {
      key: "voltage",
      header: "Voltage",
      numeric: true,
      width: 72,
      cell: (row) => asString(row.voltage) ?? "∅",
    },
    {
      key: "connected",
      header: "Connected load",
      cell: (row) =>
        joinNonEmpty([
          asString(row.apparentLoad),
          asString(row.apparentCurrent) ? `${asString(row.apparentCurrent)} A` : undefined,
        ]) || "∅",
    },
    {
      key: "rating",
      header: "Rating",
      numeric: true,
      width: 72,
      cell: (row) => (
        <span>
          {asString(row.rating) ?? "∅"}
          {row.ratingOverride === true && (
            <span title={`override: ${asString(row.ratingOverrideValueDisplay) ?? ""}`}> *</span>
          )}
        </span>
      ),
    },
    {
      key: "wire",
      header: "Wire",
      cell: (row) => joinNonEmpty([asString(row.wireSize), asString(row.wireTypeName)]) || "∅",
    },
  ];

  return (
    <Section
      label="Electrical circuits"
      aside={
        <MonoAside>
          {entries.length} circuits · {panels.length} panels
        </MonoAside>
      }
    >
      {entries.length === 0 ? (
        <EmptyState story="filter" exit="widen the circuit filter, or circuit something first">
          no circuits in scope
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {panels.map((panel) => {
            const rows = (byPanel.get(panel) ?? [])
              .slice()
              .sort((a, b) => circuitSortKey(a) - circuitSortKey(b));
            return (
              <DataTable<Rec>
                key={panel}
                title={panel}
                columns={columns}
                rows={rows}
                rowKey={(row, i) => asString(row.circuitUniqueId) ?? String(i)}
                footer={<MonoAside>{rows.length} circuits</MonoAside>}
              />
            );
          })}
        </div>
      )}
      <FilterProvenance data={record} />
      <IssuesNote data={record} />
    </Section>
  );
}

/* ── revit.catalog.electrical-load-classifications ────────────────────────── */

function LoadClassificationsView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const entries = asRecords(record.entries);

  const columns: Column<Rec>[] = [
    {
      key: "name",
      header: "Classification",
      cell: (row) => (
        <VizChip viz={2} title={asString(row.name)}>
          {asString(row.name) ?? "(unnamed)"}
        </VizChip>
      ),
    },
    { key: "abbr", header: "Abbrev", width: 64, cell: (row) => asString(row.abbreviation) ?? "∅" },
    {
      key: "kind",
      header: "Kind",
      width: 96,
      cell: (row) =>
        joinNonEmpty(
          [row.motor === true ? "motor" : undefined, row.other === true ? "other" : undefined],
          ", ",
        ) || "—",
    },
    {
      key: "space",
      header: "Space load class",
      cell: (row) => asString(row.spaceLoadClass) ?? "∅",
    },
    {
      key: "demand",
      header: "Demand factor",
      cell: (row) => {
        const demand = asRecord(row.demandFactor);
        if (!demand) return <span className="face-mono t-caption italic text-ink-mute">none</span>;
        return (
          <span title={asString(demand.name)}>
            {asString(demand.name)}{" "}
            <MonoAside>
              {joinNonEmpty(
                [
                  asString(demand.ruleType),
                  `${asNumber(demand.valuesCount) ?? 0} values`,
                  demand.includeAdditionalLoad === true
                    ? `+${asString(demand.additionalLoad) ?? "additional load"}`
                    : undefined,
                ],
                " · ",
              )}
            </MonoAside>
          </span>
        );
      },
    },
  ];

  return (
    <Section
      label="Load classifications"
      aside={<MonoAside>{entries.length} classifications</MonoAside>}
    >
      {entries.length === 0 ? (
        <EmptyState story="scope" exit="define load classifications in the model first">
          no load classifications in scope
        </EmptyState>
      ) : (
        <DataTable<Rec>
          columns={columns}
          rows={entries}
          rowKey={(row, i) => asString(row.classificationUniqueId) ?? String(i)}
        />
      )}
      <IssuesNote data={record} />
    </Section>
  );
}

/* ── revit.detail.electrical-panel-schedules — the panelboard ─────────────── */

type BreakerSlot = { num: number; load?: string; trip?: string; poles?: string };

const CKT_HEADER = /ckt|cct|circuit|^no\.?$|^#$/i;

/** Pull (circuit number, load, trip, poles) slots out of a body section's
 * row/cell projection. Returns undefined when the shape doesn't yield a
 * credible breaker list — caller falls back to the faithful grid. */
function extractBreakerSlots(body: Rec): BreakerSlot[] | undefined {
  const rows = asRecords(body.rows).filter((row) => row.isCircuitTableRow === true);
  const slots: BreakerSlot[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const cells = asRecords(row.cells)
      .slice()
      .sort((a, b) => (asNumber(a.columnNumber) ?? 0) - (asNumber(b.columnNumber) ?? 0));
    const numberIndexes: number[] = [];
    cells.forEach((cell, i) => {
      const textValue = asString(cell.displayText)?.trim() ?? "";
      if (!/^\d{1,3}$/.test(textValue)) return;
      const header = asString(cell.columnHeaderText) ?? "";
      if (asNumber(cell.circuitId) !== undefined || CKT_HEADER.test(header)) numberIndexes.push(i);
    });
    for (const i of numberIndexes) {
      const num = Number.parseInt(asString(cells[i]?.displayText) ?? "", 10);
      if (!Number.isFinite(num) || seen.has(num)) continue;
      // walk inward (right for the left gutter, left for the right gutter)
      const dir = i < cells.length / 2 ? 1 : -1;
      let load: string | undefined;
      let trip: string | undefined;
      let poles: string | undefined;
      let firstText: string | undefined;
      for (let j = i + dir; j >= 0 && j < cells.length; j += dir) {
        const cell = cells[j];
        if (!cell) break;
        const header = asString(cell.columnHeaderText) ?? "";
        if (CKT_HEADER.test(header) && numberIndexes.includes(j)) break; // crossed the spine
        const textValue = asString(cell.displayText)?.trim();
        if (!textValue) continue;
        if (!load && /load|descr|name/i.test(header)) load = textValue;
        else if (!trip && /trip|breaker|amp|rating/i.test(header)) trip = textValue;
        else if (!poles && /pole/i.test(header)) poles = textValue;
        else if (!firstText && !/^[\d.,/-]+$/.test(textValue)) firstText = textValue;
      }
      seen.add(num);
      slots.push({ num, load: load ?? firstText, trip, poles });
    }
  }
  return slots.length >= 2 ? slots : undefined;
}

function BreakerHalf({ slot, side }: { slot: BreakerSlot | undefined; side: "left" | "right" }) {
  const gutter = (
    <span
      className={`face-mono t-label w-[34px] shrink-0 px-1.5 py-1 text-ink ${side === "left" ? "text-right" : "text-left"}`}
    >
      {slot?.num ?? ""}
    </span>
  );
  const facts = slot && (slot.trip || slot.poles) && (
    <span className="face-mono t-caption shrink-0 px-1 text-ink-2">
      {joinNonEmpty([slot.trip, slot.poles ? `${slot.poles}P` : undefined], "/")}
    </span>
  );
  const load = (
    <span
      className={`t-value min-w-0 flex-1 truncate px-1.5 py-1 ${side === "right" ? "text-right" : ""}`}
      title={slot?.load}
    >
      {slot ? (slot.load ?? <span className="text-ink-mute">—</span>) : ""}
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
  return (
    <div
      className={`flex min-w-0 items-center ${side === "left" ? "border-r-[1.5px] border-r-line-2" : ""}`}
    >
      {inner}
    </div>
  );
}

/** Two-column panelboard: odd circuits left, even right, numbers in the outer
 * gutters, loads inward, spine down the middle. */
function Panelboard({ slots }: { slots: BreakerSlot[] }) {
  const odds = slots.filter((s) => s.num % 2 === 1).sort((a, b) => a.num - b.num);
  const evens = slots.filter((s) => s.num % 2 === 0).sort((a, b) => a.num - b.num);
  const rowCount = Math.max(odds.length, evens.length);
  return (
    <div>
      {Array.from({ length: rowCount }, (_, i) => (
        <div key={i} className={`grid grid-cols-2 ${i > 0 ? "border-t border-line" : ""}`}>
          <BreakerHalf slot={odds[i]} side="left" />
          <BreakerHalf slot={evens[i]} side="right" />
        </div>
      ))}
    </div>
  );
}

/** Faithful row/cell grid for a section — the honest fallback when the odd/even
 * reconstruction can't be trusted. */
function SectionGrid({ section }: { section: Rec }) {
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

/** Header/Summary/Footer sections render as quiet mono lines of their non-blank text. */
function SectionLines({ section }: { section: Rec }) {
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

function PanelScheduleCard({ entry }: { entry: Rec }) {
  const sections = asRecords(entry.sections);
  const header = sections.find((s) => asString(s.sectionType) === "Header");
  const body = sections.find((s) => asString(s.sectionType) === "Body");
  const summary = sections.find((s) => asString(s.sectionType) === "Summary");
  const footer = sections.find((s) => asString(s.sectionType) === "Footer");
  const slots = body ? extractBreakerSlots(body) : undefined;
  const panelName = asString(entry.panelName) ?? asString(entry.scheduleName) ?? "(unnamed panel)";
  return (
    <article className="min-w-0 rounded-md border border-line-2">
      {/* the head band is a recessed ground shift — --r-on re-declared with it. */}
      <div
        className="flex items-baseline justify-between gap-2 border-b border-line-2 px-2 py-1.5"
        style={
          { background: "var(--r-recess)", "--r-on": "var(--r-recess)" } as React.CSSProperties
        }
      >
        <h3 className="face-mono t-value truncate" title={panelName}>
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
          <div className={header ? "border-t border-line" : undefined}>
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
        <div className="border-t border-line">
          <SectionLines section={summary} />
        </div>
      )}
      {footer && (
        <div className="border-t border-line">
          <SectionLines section={footer} />
        </div>
      )}
    </article>
  );
}

function PanelSchedulesView({ data }: OpViewProps) {
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

/* ── registry ─────────────────────────────────────────────────────────────── */

export const views: OpViewRegistry = {
  "revit.catalog.electrical-panels": PanelsView,
  "revit.catalog.electrical-circuits": CircuitsView,
  "revit.catalog.electrical-load-classifications": LoadClassificationsView,
  "revit.detail.electrical-panel-schedules": PanelSchedulesView,
};
