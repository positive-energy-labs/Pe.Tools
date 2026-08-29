import { token } from "#/lib/token";
import type { ReactNode } from "react";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { KVGrid, type KVTone } from "#/ops/primitives";
import {
  type OpViewProps,
  type OpViewRegistry,
  UnrecognizedShape,
  asNumber,
  asRecord,
  asRecords,
  asString,
  text,
} from "#/ops/registry";
import {
  ContextSummaryView,
  HandleChip,
  IssueLines,
  formatBytes,
  handleId,
  handleLabel,
  truncateMiddle,
} from "./views-context-kind-viz";
import { DocumentSessionView, VisibleSummaryView } from "./views-context-document-tab";
import { ScoreBar, ViewRenderingStateView } from "./views-context-observed-view-card";

export function ResolveReferencesView({ data }: OpViewProps) {
  const res = asRecord(data);
  if (!res || !Array.isArray(res.candidates)) return <UnrecognizedShape />;
  const candidates = [...asRecords(res.candidates)].sort(
    (a, b) => (asNumber(b.score) ?? 0) - (asNumber(a.score) ?? 0),
  );
  const candidateCount = asNumber(res.candidateCount) ?? candidates.length;
  const ambiguous = candidateCount > 1;
  const maxScore = candidates.reduce((acc, c) => Math.max(acc, asNumber(c.score) ?? 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="min-w-0">
        <div className="face-mono t-caption t-upper text-ink-2">REFERENCE</div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="t-title min-w-0 font-medium">“{text(res.referenceText)}”</span>
          <span
            className="face-mono t-caption"
            style={{
              color:
                candidateCount === 1
                  ? token("done")
                  : candidateCount === 0
                    ? token("caution")
                    : token("caution"),
            }}
          >
            {candidateCount === 0
              ? "no matches"
              : candidateCount === 1
                ? "resolved"
                : `${candidateCount} candidates — ambiguous`}
          </span>
        </div>
      </div>

      {candidates.length === 0 ? (
        <EmptyState
          story="scope"
          exit="loosen the reference text, or check the model has the thing"
        >
          nothing in the model matched this reference
        </EmptyState>
      ) : (
        <div className="flex flex-col rounded-sm border border-line">
          {candidates.map((candidate, i) => {
            const handle = asRecord(candidate.handle);
            const related = asRecords(candidate.relatedHandles);
            const provenance = asRecords(candidate.provenance);
            const score = asNumber(candidate.score);
            const top = i === 0;
            const edge = top ? token("ink") : ambiguous ? token("caution") : "transparent";
            return (
              <div
                key={handle ? `${handleId(handle)}-${i}` : i}
                className={`flex min-w-0 flex-col gap-1 border-l-2 px-2.5 py-2 ${i < candidates.length - 1 ? "border-b border-b-line" : ""}`}
                style={{ borderLeftColor: edge }}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="face-mono t-caption w-6 shrink-0 text-ink-2">#{i + 1}</span>
                  {handle && <HandleChip handle={handle} />}
                  <span className={`t-value min-w-0 truncate ${top ? "font-medium" : ""}`}>
                    {text(candidate.label)}
                  </span>
                  {handle && (
                    <span className="face-mono t-caption text-ink-2">{handleId(handle)}</span>
                  )}
                  {score !== undefined && (
                    <span className="ml-auto">
                      <ScoreBar score={score} max={maxScore} muted={!top && ambiguous} />
                    </span>
                  )}
                </div>
                {related.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pl-6">
                    {related.map((rel, j) => (
                      <HandleChip key={j} handle={rel} />
                    ))}
                  </div>
                )}
                {provenance.length > 0 && (
                  <details className="pl-6">
                    <summary className="face-mono t-caption cursor-pointer select-none text-ink-2">
                      provenance ({provenance.length})
                    </summary>
                    <div className="mt-0.5 flex flex-col gap-0.5">
                      {provenance.map((p, j) => (
                        <Provenance key={j}>
                          {asString(p.kind) ? `${text(p.kind)} — ` : ""}
                          {text(p.description) || text(p)}
                        </Provenance>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
      {candidates.length > 0 && (
        <Provenance>
          ranked by score, descending · bars normalized against the best score in this set (
          {maxScore}) — scores are relative evidence, not absolute confidence
        </Provenance>
      )}
      <IssueLines issues={res.issues} />
    </div>
  );
}

export function ViewImageView({ data }: OpViewProps) {
  const res = asRecord(data);
  const filePath = res && asString(res.filePath);
  if (!res || !filePath) return <UnrecognizedShape />;

  const view = asRecord(res.view);
  const modelRect = asRecord(res.modelRect);
  const byteSize = asNumber(res.byteSize);
  const viewScale = asNumber(res.viewScale);
  const sheetNumber = asString(res.sheetNumber);

  const items: { label: string; value: ReactNode; tone?: KVTone }[] = [
    { label: "view", value: view ? handleLabel(view) : "∅" },
    { label: "pixel size", value: `${text(res.pixelSize)} px (long edge)` },
    { label: "file size", value: byteSize !== undefined ? formatBytes(byteSize) : "∅" },
  ];
  if (viewScale !== undefined) items.push({ label: "view scale", value: `1:${viewScale}` });
  if (sheetNumber) items.push({ label: "sheet", value: sheetNumber });

  return (
    <div className="flex flex-col gap-4">
      <Section label="exported image">
        <KVGrid columns={3} items={items} />
        <div className="mt-2">
          <div className="t-label text-ink-2">file path</div>
          <div className="face-mono t-value" title={filePath}>
            {truncateMiddle(filePath, 72)}
          </div>
        </div>
      </Section>

      {modelRect && (
        <Section label="model extent">
          <KVGrid
            columns={2}
            items={[
              { label: "min (x, y)", value: `${text(modelRect.minX)}, ${text(modelRect.minY)} ft` },
              { label: "max (x, y)", value: `${text(modelRect.maxX)}, ${text(modelRect.maxY)} ft` },
            ]}
          />
        </Section>
      )}

      <Provenance>
        path is local to the Revit host machine — not fetchable from this browser
        {modelRect
          ? " · model extent in feet, project internal coordinates"
          : " · no model extent reported (sheet or schedule capture)"}
      </Provenance>
    </div>
  );
}

export const views: OpViewRegistry = {
  "revit.context.summary": ContextSummaryView,
  "revit.context.document-session": DocumentSessionView,
  "revit.context.visible-summary": VisibleSummaryView,
  "revit.context.view-rendering-state": ViewRenderingStateView,
  "revit.resolve.references": ResolveReferencesView,
  "revit.context.view-image": ViewImageView,
};
