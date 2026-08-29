import { FactChip, type FactTone } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { DataTable, VizChip, type VizIndex } from "#/ops/primitives";
import {
  type OpViewProps,
  UnrecognizedShape,
  asArray,
  asNumber,
  asRecord,
  asRecords,
  asString,
} from "#/ops/registry";
import { ChipRow, Dash, IssuesNote, MonoAside, pageNote, vizFor } from "./viz-cycle";

export function ParameterBindingsView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const entries = asRecords(record.entries);
  const summary = asRecord(record.summary) ?? {};

  return (
    <Section label="Project Parameter Bindings">
      <DataTable
        title="Project Parameters"
        rows={entries}
        rowKey={(row, i) => asString(asRecord(asRecord(row.definition)?.identity)?.key) ?? `${i}`}
        columns={[
          {
            key: "name",
            header: "Parameter",
            cell: (row) => asString(asRecord(asRecord(row.definition)?.identity)?.name) ?? "∅",
          },
          {
            key: "kind",
            header: "Binding",
            cell: (row) => {
              const kind = asString(row.bindingKind);
              if (!kind) return <Dash />;
              return <VizChip viz={kind === "Instance" ? 3 : 6}>{kind}</VizChip>;
            },
          },
          {
            key: "categories",
            header: "Categories",
            cell: (row) => (
              <ChipRow
                values={asArray(row.categoryNames).flatMap((v) =>
                  typeof v === "string" ? [v] : [],
                )}
                viz={vizFor}
              />
            ),
          },
          {
            key: "group",
            header: "Group",
            cell: (row) => asString(asRecord(row.definition)?.groupTypeLabel) ?? "—",
          },
          {
            key: "dataType",
            header: "Data Type",
            cell: (row) => asString(asRecord(row.definition)?.dataTypeLabel) ?? "—",
          },
        ]}
        footer={
          <Provenance>
            {asNumber(summary.totalBindings) ?? entries.length} bindings ·{" "}
            {asNumber(summary.instanceBindings) ?? "?"} instance /{" "}
            {asNumber(summary.typeBindings) ?? "?"} type
            {summary.truncated === true ? " · truncated by budget" : ""}
            {pageNote(record) ? ` · ${pageNote(record)}` : ""}
          </Provenance>
        }
      />
      <IssuesNote data={record} />
    </Section>
  );
}

export const EVIDENCE_VIZ: Record<string, VizIndex> = {
  ProjectBinding: 1,
  ScheduleField: 2,
  ScheduleFilter: 4,
  ScopedElement: 5,
};

export function ParameterEvidenceView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const candidates = asRecords(record.candidates);
  const collectedAt = asString(record.evidenceCollectedAtUtc);

  return (
    <Section
      label="Parameter Evidence"
      aside={record.primitiveCacheHit === true ? <MonoAside>cache hit</MonoAside> : undefined}
    >
      <DataTable
        title="Evidence Ledger"
        rows={candidates}
        rowKey={(row, i) => asString(asRecord(row.identity)?.key) ?? `${i}`}
        columns={[
          {
            key: "parameter",
            header: "Parameter",
            cell: (row) => asString(asRecord(row.identity)?.name) ?? "∅",
          },
          {
            key: "score",
            header: "Score",
            numeric: true,
            cell: (row) => asNumber(row.score)?.toFixed(2) ?? "—",
          },
          {
            key: "sources",
            header: "Evidence Sources",
            cell: (row) => {
              const counts = asRecords(row.evidenceCounts);
              if (counts.length === 0) return <Dash />;
              return (
                <span className="inline-flex flex-wrap gap-1">
                  {counts.map((count, i) => {
                    const source = asString(count.source) ?? "?";
                    return (
                      <VizChip
                        key={`${source}-${asString(count.scope) ?? i}`}
                        viz={EVIDENCE_VIZ[source] ?? 3}
                        title={`${source} · scope ${asString(count.scope) ?? "?"} · ${asString(count.strength) ?? "?"}`}
                      >
                        {source} {asNumber(count.count) ?? "?"}
                      </VizChip>
                    );
                  })}
                </span>
              );
            },
          },
          {
            key: "total",
            header: "Total",
            numeric: true,
            cell: (row) =>
              asRecords(row.evidenceCounts).reduce((acc, c) => acc + (asNumber(c.count) ?? 0), 0),
          },
          {
            key: "reasons",
            header: "Reasons",
            cell: (row) => {
              const reasons = asArray(row.reasons).flatMap((v) =>
                typeof v === "string" ? [v] : [],
              );
              return reasons.length > 0 ? (
                <span title={reasons.join("\n")}>{reasons[0]}</span>
              ) : (
                <Dash />
              );
            },
          },
        ]}
        footer={
          <Provenance>
            {collectedAt ? `evidence collected ${collectedAt}` : "collection time not reported"}
            {pageNote(record) ? ` · ${pageNote(record)}` : ""}
            {" · counts are observations at collection time, not live proof"}
          </Provenance>
        }
      />
      <IssuesNote data={record} />
    </Section>
  );
}

export const CONFIDENCE_TONE: Record<string, FactTone> = {
  Low: "caution",
  Medium: "meta",
  High: "done",
};

export function ConceptEvidenceView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const concepts = asRecords(record.concepts);
  if (concepts.length === 0)
    return (
      <EmptyState story="scope" exit="name at least one concept in the request">
        no concepts inferred
      </EmptyState>
    );

  return (
    <div className="space-y-4">
      {concepts.map((concept, ci) => {
        const conceptName = asString(concept.concept) ?? `concept ${ci + 1}`;
        const candidates = asRecords(concept.candidates);
        const notes = asArray(concept.evidenceNotes).flatMap((v) =>
          typeof v === "string" ? [v] : [],
        );
        return (
          <Section
            key={conceptName}
            label={conceptName}
            aside={<MonoAside>{candidates.length} candidates</MonoAside>}
          >
            <div className="">
              {candidates.map((candidate, i) => {
                const identity = asRecord(candidate.identity);
                const confidence = asString(candidate.confidence);
                const facts = asRecord(candidate.facts) ?? {};
                const reasons = asArray(candidate.reasons).flatMap((v) =>
                  typeof v === "string" ? [v] : [],
                );
                return (
                  <div
                    key={asString(identity?.key) ?? `${i}`}
                    className="flex min-w-0 items-baseline gap-2 px-2 py-1.5"
                  >
                    <span className="w-6 shrink-0 text-right">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="">{asString(identity?.name) ?? "∅"}</span>
                        {confidence && (
                          <FactChip
                            tone={CONFIDENCE_TONE[confidence] ?? "meta"}
                            title="inference confidence, ranked by the host"
                          >
                            {confidence.toLowerCase()}
                          </FactChip>
                        )}
                        <MonoAside>score {asNumber(candidate.score)?.toFixed(2) ?? "?"}</MonoAside>
                      </div>
                      {reasons.length > 0 && <p className="mt-0.5">{reasons.join(" · ")}</p>}
                      <MonoAside>
                        {asNumber(facts.bindingCount) ?? 0} bindings ·{" "}
                        {asNumber(facts.scheduleFieldCount) ?? 0} schedule fields ·{" "}
                        {asNumber(facts.placedScheduleFieldCount) ?? 0} placed
                      </MonoAside>
                    </div>
                  </div>
                );
              })}
              {candidates.length === 0 && (
                <div className="px-2 py-4 text-center">no candidates</div>
              )}
            </div>
            {notes.length > 0 && <Provenance>{notes.join(" · ")}</Provenance>}
          </Section>
        );
      })}
      <Provenance>
        {asString(record.evidenceCollectedAtUtc)
          ? `evidence collected ${asString(record.evidenceCollectedAtUtc)}`
          : "collection time not reported"}
        {record.primitiveCacheHit === true ? " · cache hit" : ""}
        {pageNote(record) ? ` · ${pageNote(record)}` : ""}
      </Provenance>
      <IssuesNote data={record} />
    </div>
  );
}

export const FIELD_OPTIONS_CAP = 60;
