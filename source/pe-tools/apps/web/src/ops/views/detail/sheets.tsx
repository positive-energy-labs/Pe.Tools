import { token } from "#/lib/token";
import type {
  RevitDetailElements,
  RevitDetailParameterLinks,
  RevitDetailSheets,
} from "@pe/host-contracts/generated";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { KVGrid, VizChip } from "#/ops/primitives";
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

export function ParameterRows({
  label,
  params,
}: {
  label: string;
  params: RevitDetailElements.Res.RequestedElementParameterValue[];
}) {
  if (params.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="mb-1">{label}</div>
      <div className="">
        {params.map((p) => (
          <div key={p.identity.key} className="flex items-baseline justify-between gap-3 px-2 py-1">
            <span className="min-w-0 truncate" title={p.name}>
              {p.name}
            </span>
            <span
              className="shrink-0 text-right"
              style={{ color: !p.found || p.isBlank ? token("caution") : undefined }}
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

export function ElementCard({ entry }: { entry: RevitDetailElements.Res.ElementContextEntry }) {
  const params = entry.requestedParameters ?? [];
  const instanceParams = params.filter((p) => p.source === "Instance");
  const typeParams = params.filter((p) => p.source === "Type");
  const otherParams = params.filter((p) => p.source !== "Instance" && p.source !== "Type");
  const grouped = instanceParams.length > 0 || typeParams.length > 0;

  return (
    <div className="p-2">
      <div className="flex flex-wrap items-center gap-2">
        {entry.categoryName && <VizChip viz={1}>{entry.categoryName}</VizChip>}
        <span className="">{entry.name}</span>
        {entry.familyName && (
          <span className="">
            {entry.familyName}
            {entry.typeName ? ` : ${entry.typeName}` : ""}
          </span>
        )}
        <span className="ml-auto">{entry.elementId}</span>
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
        {entry.electrical && <VizChip viz={4}>{entry.electrical.role}</VizChip>}
        {entry.circuit && (
          <VizChip viz={1} title={entry.circuit.loadName ?? undefined}>
            ckt {entry.circuit.circuitNumber}
            {entry.circuit.panelName ? ` @ ${entry.circuit.panelName}` : ""}
          </VizChip>
        )}
        {entry.panelContext && (
          <VizChip viz={2}>
            panel {entry.panelContext.panelName} · {entry.panelContext.assignedCircuitCount} ckts
          </VizChip>
        )}
        {entry.connectors && entry.connectors.electricalConnectorCount > 0 && (
          <VizChip viz={3}>{entry.connectors.electricalConnectorCount} elec connectors</VizChip>
        )}
        {entry.panelSchedule && <VizChip viz={2}>sched {entry.panelSchedule.scheduleName}</VizChip>}
        {entry.loadClassification && <VizChip viz={6}>{entry.loadClassification.name}</VizChip>}
        {entry.wire && (
          <VizChip viz={3}>wire {entry.wire.wireTypeName ?? entry.wire.wiringType}</VizChip>
        )}
      </div>
    </div>
  );
}

export function ElementsView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec || !Array.isArray(rec.entries)) return <UnrecognizedShape />;
  const res = rec as unknown as RevitDetailElements.Res.Response;
  if (res.entries.length === 0)
    return (
      <EmptyState story="filter" exit="widen the element reference query">
        no elements resolved
      </EmptyState>
    );

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
