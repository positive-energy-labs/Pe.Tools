import { EmptyState } from "#/components/lang/empty";
import { Section } from "#/components/lang/section";
import { type Column, DataTable, VizChip } from "#/ops/primitives";
import {
  asNumber,
  asRecord,
  asRecords,
  asString,
  type OpViewProps,
  UnrecognizedShape,
} from "#/ops/registry";
import type { Rec } from "./record";
import { FilterProvenance, IssuesNote, MonoAside, circuitSortKey, joinNonEmpty } from "./record";

export function CircuitsView({ data }: OpViewProps) {
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
            (row.isEmpty === true ? <span className="">spare/space</span> : "∅")}
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

export function LoadClassificationsView({ data }: OpViewProps) {
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
        if (!demand) return <span className="">none</span>;
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

export type BreakerSlot = { num: number; load?: string; trip?: string; poles?: string };

export const CKT_HEADER = /ckt|cct|circuit|^no\.?$|^#$/i;

export function extractBreakerSlots(body: Rec): BreakerSlot[] | undefined {
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
