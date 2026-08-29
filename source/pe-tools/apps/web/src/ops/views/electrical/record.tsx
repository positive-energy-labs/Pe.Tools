import { token } from "#/lib/token";
import type { ReactNode } from "react";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { KVGrid, VizChip } from "#/ops/primitives";
import {
  asNumber,
  asRecord,
  asRecords,
  asString,
  type OpViewProps,
  UnrecognizedShape,
} from "#/ops/registry";

export type Rec = Record<string, unknown>;

export function joinNonEmpty(parts: (string | undefined)[], sep = " · "): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(sep);
}

export function MonoAside({ children }: { children: ReactNode }) {
  return <span className="">{children}</span>;
}

export function IssuesNote({ data }: { data: Rec }) {
  const issues = asRecords(data.issues);
  if (issues.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {issues.map((issue, i) => {
        const severity = asString(issue.severity) ?? "Info";
        return (
          <span
            key={i}
            className=""
            style={{ color: severity === "Info" ? token("ink-2") : token("caution") }}
          >
            {severity.toLowerCase()}: {asString(issue.code)} — {asString(issue.message)}
          </span>
        );
      })}
    </div>
  );
}

export function FilterProvenance({ data }: { data: Rec }) {
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

export function PanelsView({ data }: OpViewProps) {
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
              <article key={asString(panel.panelUniqueId) ?? i} className="min-w-0 p-2">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <h3 className="truncate" title={asString(panel.panelName)}>
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

export function circuitSortKey(entry: Rec): number {
  const n = Number.parseInt(asString(entry.circuitNumber) ?? "", 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}
