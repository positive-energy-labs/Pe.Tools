/**
 * The two spatial views of /ducts, `page.view` `plan` and `iso`: one drawing (`drawing.tsx`)
 * under one legend band, beside the facts of what is hovered or selected. Both scope the same way
 * (the subject group at full weight, the rest faint) and ink the same way (`encoding.tsx`); they
 * differ only in the projection and what they hand it (`plan.tsx`, `iso.tsx`).
 */
import { useMemo, useState } from "react";

import { EmptyState } from "#/components/lang/empty";
import { FactChip } from "#/components/lang/chip";
import { Pane } from "#/components/lang/pane";
import { PaneSplit } from "#/components/lang/pane-resize";
import { Press } from "#/components/lang/press";
import { DuctDrawing, GlyphKey, type Scene } from "./drawing";
import { ENCODING_KEYS, ENCODINGS, encodingOf, type Encoding } from "./encoding";
import { NodeFactsView, SegmentFactsView } from "./facts";
import { IssueLegend } from "./issues";
import { useIso } from "./iso";
import type { DuctsPage } from "./manifest";
import { usePlan } from "./plan";
import type { DuctSnapshot, GroupReadiness } from "./readiness";
import { indexOf, type DuctIndex } from "./scene";
import { READY } from "./tables";

function EncodingBand({
  encoding,
  encodingKey,
  scene,
  snapshot,
  pick,
}: {
  encoding: Encoding;
  encodingKey: string;
  scene: Scene;
  snapshot: DuctSnapshot;
  pick: (key: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const facts of scene.segments) {
    const bin = encoding.bin(facts);
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
  }
  const layer = encoding.layer ? snapshot.layers.find((l) => l.key === encoding.layer) : null;
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="encoding legend">
      {ENCODING_KEYS.map((key) => (
        <Press
          key={key}
          type="button"
          frame="line"
          size="caption"
          state={key === encodingKey ? "selected" : "rest"}
          aria-pressed={key === encodingKey}
          title={ENCODINGS[key].says}
          onClick={() => pick(key)}
        >
          {ENCODINGS[key].label}
        </Press>
      ))}
      {Object.entries(encoding.bins).map(([key, bin]) => (
        <FactChip key={key} title={bin.says}>
          <span className="flex items-center gap-1" data-bin={key}>
            <svg aria-hidden width="18" height="10" viewBox="0 0 18 10">
              <line
                x1="1"
                y1="5"
                x2="17"
                y2="5"
                stroke={bin.stroke.ink}
                strokeWidth={Math.min(bin.stroke.width, 8)}
                className={bin.stroke.dash ? `dash-${bin.stroke.dash}` : undefined}
              />
            </svg>
            {bin.word} <span className="face-mono">{counts.get(key) ?? 0}</span>
          </span>
        </FactChip>
      ))}
      {layer ? (
        <FactChip title={layer.query}>
          {layer.title} · {layer.provenance} ·{" "}
          <span className="face-mono">
            {layer.coverage.have}/{layer.coverage.of}
          </span>{" "}
          in the document
        </FactChip>
      ) : null}
    </div>
  );
}

export function DuctsSpatial({
  snapshot,
  ready,
  page,
  setPage,
  empty,
}: {
  snapshot: DuctSnapshot | null;
  ready: Record<string, GroupReadiness>;
  page: DuctsPage;
  setPage: (next: Partial<DuctsPage>) => void;
  empty: { says: string; exit: string } | null;
}) {
  const index = useMemo(() => (snapshot ? indexOf(snapshot) : null), [snapshot]);
  if (!index || empty)
    return (
      <div className="flex size-full items-center justify-center">
        <EmptyState story="scope" exit={empty?.exit ?? "wait for the snapshot"}>
          {empty?.says ?? "reading ducts…"}
        </EmptyState>
      </div>
    );
  return <Spatial index={index} ready={ready} page={page} setPage={setPage} />;
}

function Spatial({
  index,
  ready,
  page,
  setPage,
}: {
  index: DuctIndex;
  ready: Record<string, GroupReadiness>;
  page: DuctsPage;
  setPage: (next: Partial<DuctsPage>) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const encoding = encodingOf(page.encoding);
  const plan = usePlan(index, page);
  const iso = useIso(index, page);
  const view = page.view === "iso" ? iso : plan;
  const selected = page.selected ? Number(page.selected) : null;
  const readiness = page.group ? ready[page.group] : undefined;
  const shown = hovered ?? selected;
  const pickedIssue = page.issue
    ? (index.snapshot.issues.find((issue) => issue.id === page.issue) ?? null)
    : null;

  const segment = shown == null ? null : view.scene.segments.find((f) => f.segment.id === shown);
  const node = shown == null ? null : view.scene.nodes.find((f) => f.node.id === shown);

  return (
    <PaneSplit
      axis="horizontal"
      grow
      resize={{ target: "end", defaultSize: 360, minSize: 240, persist: "pe.ducts.factsWidth" }}
      start={
        <Pane
          kind="content"
          title={view.label}
          meta={`${view.scene.segments.length} segments · ${view.scene.issues.length} issues`}
          scroll="clip"
          flush
        >
          <div className="flex size-full min-h-0 flex-col">
            <div className="flex flex-col gap-1 px-1 py-1">
              <div className="flex flex-wrap items-center gap-1">
                {view.band}
                {readiness ? (
                  <FactChip
                    tone={READY[readiness.level].tone}
                    title={`${page.group}: ${READY[readiness.level].note}; ${readiness.walk.length} open issues block walking, ${readiness.budget.length} block the budget`}
                  >
                    {READY[readiness.level].word} {readiness.walk.length}/{readiness.budget.length}
                  </FactChip>
                ) : (
                  <FactChip title="the drawing shows the document faint until a group is chosen">
                    no group chosen: choose one in the sentence or the tables
                  </FactChip>
                )}
                <GlyphKey />
              </div>
              <EncodingBand
                encoding={encoding}
                encodingKey={page.encoding}
                scene={view.scene}
                snapshot={index.snapshot}
                pick={(key) => setPage({ encoding: key })}
              />
            </div>
            <DuctDrawing
              label={view.label}
              project={view.project}
              scene={view.scene}
              encoding={encoding}
              fitKey={view.fitKey}
              selected={selected}
              hovered={hovered}
              issue={page.issue}
              onHover={setHovered}
              onSelect={(id) => setPage({ selected: id == null ? "" : String(id), issue: "" })}
              onSelectIssue={(issue) =>
                setPage({
                  issue: issue.id,
                  selected: issue.elementId == null ? "" : String(issue.elementId),
                })
              }
              onDrag={view.onDrag}
              underlay={view.underlay}
            />
          </div>
        </Pane>
      }
      end={
        <Pane kind="content" title="facts" scroll="auto">
          <div className="flex flex-col gap-3">
            {segment ? (
              <SegmentFactsView {...segment} />
            ) : node ? (
              <NodeFactsView {...node} />
            ) : (
              <p className="text-ink-2">
                {shown == null
                  ? "hover a segment or a node for its facts; click to select it"
                  : `element ${shown} is not drawn in this view`}
              </p>
            )}
            {pickedIssue ? (
              <p data-picked-issue={pickedIssue.id}>
                selected issue <span className="face-mono">{pickedIssue.id}</span>:{" "}
                {pickedIssue.note}
              </p>
            ) : null}
            <IssueLegend />
          </div>
        </Pane>
      }
    />
  );
}
