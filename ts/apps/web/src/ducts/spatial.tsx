/**
 * The two spatial views of /ducts, `page.view` `plan` and `iso`: one drawing (`drawing.tsx`)
 * under one legend band, beside the facts of what is hovered or selected. Both scope the same way
 * (the subject group at full weight, the rest faint) and ink the same way (`encoding.tsx`); they
 * differ only in the projection and what they hand it (`plan.tsx`, `iso.tsx`).
 * `page.scene` `subject` swaps the group scene for the subject scene (`subjectScene`): the ordered
 * ids cut into legs (`legs.ts`), with the claims pinned and listed under the drawing. Selection is
 * one place set across plan, iso, the inset and the claim list: a claim selects its places and
 * their legs; an element on a leg selects the leg.
 */
import { useMemo, useState } from "react";
import type { DuctsRouteDocument } from "@pe/agent-contracts";

import { EmptyState } from "@pe/kit/lang/empty";
import { FactChip } from "@pe/kit/lang/chip";
import { Pane } from "#/components/lang/pane";
import { PaneSplit } from "#/components/lang/pane-resize";
import { Switcher } from "#/components/lang/switcher";
import { ClaimsList, elementNamer, LegFacts, nameOf, PlaceFacts, ShowInRevit } from "./claims";
import { DuctDrawing, GlyphKey } from "./drawing";
import { EncodingPicker } from "./proto/encoding/picker"; // proto: encoding
import { ScaleLegend } from "./proto/encoding/scale-legend"; // proto: encoding
import { useGroupEncoding } from "./proto/encoding/use-encoding"; // proto: encoding
import { NodeFactsView, SegmentFactsView } from "./facts";
import { IssueLegend } from "./issues";
import { useIso } from "./iso";
import { labelOfNode, legsOf, type Claim, type SubjectCut } from "./legs";
import type { DuctsPage } from "./manifest";
import { usePlan } from "./plan";
import type { Priced } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { GroupReadiness } from "@pe/ducts-domain/readiness";
import { indexOf, subjectScene, type DuctIndex } from "./scene";
import { READY } from "./tables";
import { groupTree, runsOf } from "@pe/ducts-domain/topology";

/** proto: orbit — a sidebar lights a set: `const { hovered, hover } = useHoverSet()`, pass `hovered` here, call `hover(ids)` from rows. */
export { useHoverSet, type HoverTarget } from "./proto/orbit/lens";

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The authored half of a subject scene: the ordered ids and the claims over them. */
export interface Subject {
  ids: readonly number[];
  claims: readonly Claim[];
  /** A person's verdict on one claim; the route stages it. */
  onVerdict: (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => void;
  /** The Work whose staged ignore verdicts the cut's proximity inferences honor; null honors none. */
  work?: DuctsRouteDocument | null;
}

/** "3 inferred: 1 anomalous, 1 stretched, 1 confirmed": the breaks a person has not ruled on by grade, worst first. */
const inferredMeta = (breaks: SubjectCut["inferred"]) => {
  const by = (pick: (b: SubjectCut["inferred"][number]) => boolean) => breaks.filter(pick).length;
  const parts = [
    [by((b) => !b.confirmed && b.grade === "anomalous"), "anomalous"],
    [by((b) => !b.confirmed && b.grade === "stretched"), "stretched"],
    [by((b) => !b.confirmed && b.grade === "near-miss"), "near miss"],
    [by((b) => b.confirmed), "confirmed"],
  ] as const;
  return `${breaks.length} inferred: ${parts
    .filter(([n]) => n)
    .map(([n, word]) => `${n} ${word}`)
    .join(", ")}`;
};
export function DuctsSpatial({
  snapshot,
  ready,
  priced,
  page,
  setPage,
  empty,
  subject = null,
  doc = null,
  hovered, // proto: orbit
}: {
  snapshot: DuctSnapshot | null;
  ready: Record<string, GroupReadiness>;
  /** Pe's priced losses, null until the ASHRAE tables are read; the drawing inks without them. */
  priced: Priced | null;
  page: DuctsPage;
  setPage: (next: Partial<DuctsPage>) => void;
  empty: { says: string; exit: string } | null;
  /** The subject scene's authored layers; null when none is staged, and the scene switch is hidden. */
  subject?: Subject | null;
  /** The connected document; null hides every crossing into Revit. */
  doc?: { session: string; openId: string } | null;
  /** proto: orbit — a hovered set from a sidebar (`useHoverSet`); one id or many, empty for none. */
  hovered?: ReadonlySet<number>;
}) {
  const index = useMemo(() => (snapshot ? indexOf(snapshot, priced) : null), [snapshot, priced]);
  if (!index || empty)
    return (
      <div className="flex size-full items-center justify-center">
        <EmptyState story="scope" exit={empty?.exit ?? "wait for the snapshot"}>
          {empty?.says ?? "reading ducts…"}
        </EmptyState>
      </div>
    );
  return (
    <Spatial
      index={index}
      ready={ready}
      priced={priced}
      page={page}
      setPage={setPage}
      subject={subject}
      doc={doc}
      hovered={hovered}
    />
  );
}

export function Spatial({ // proto: orbit (exported for the variants)
  index,
  ready,
  priced,
  page,
  setPage,
  subject,
  doc,
  hovered: lit, // proto: orbit
}: {
  index: DuctIndex;
  ready: Record<string, GroupReadiness>;
  priced: Priced | null;
  page: DuctsPage;
  setPage: (next: Partial<DuctsPage>) => void;
  subject: Subject | null;
  doc: { session: string; openId: string } | null;
  hovered?: ReadonlySet<number>; // proto: orbit
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { encoding, counts, nameOf: nameOfEncoded } = useGroupEncoding(index.snapshot, priced, page.group, page.encoding);
  // A place's name is the node's label (the staged labelParameter's value); the cut falls back to type and kind.
  const labelOf = useMemo(() => labelOfNode(index.snapshot), [index]);
  const subjectDrawn = useMemo(
    () =>
      page.scene === "subject" && subject
        ? subjectScene(
            index,
            subject.ids,
            legsOf(index.snapshot, subject.ids, labelOf, subject.work ?? null),
            subject.claims,
          )
        : null,
    [index, page.scene, subject, labelOf],
  );
  const plan = usePlan(index, page, subjectDrawn);
  const iso = useIso(index, page, subjectDrawn);
  const view = page.view === "iso" ? iso : plan;
  const sub = view.scene.subject ?? null;
  const nameOfId = useMemo(() => elementNamer(index.snapshot, sub), [index, sub]);
  // `page.selected` is an element id, or a claim id in a subject scene.
  const claimPicked = sub?.claims.find((claim) => claim.id === page.selected) ?? null;
  const selected = page.selected && !claimPicked ? Number(page.selected) : null;
  const tree = useMemo(() => groupTree(index.snapshot, page.group), [index, page.group]);
  // Pe's critical terminal for the group, when priced; else the longest run stands in.
  const criticalTerminal = page.group ? priced?.now.byGroup[page.group]?.critical : null;
  const criticalRun =
    criticalTerminal == null ? null : runsOf(tree).find((run) => run.terminal === criticalTerminal);
  const critical = new Set(criticalRun?.path ?? tree.longest);
  const selection = useMemo(() => {
    if (sub && claimPicked) {
      const ids = new Set(claimPicked.at);
      for (const leg of sub.cut.legs)
        if (
          claimPicked.at.some(
            (id) => leg.ids.includes(id) || leg.from.id === id || leg.to.id === id,
          )
        )
          for (const id of leg.ids) ids.add(id);
      return ids;
    }
    if (sub && selected != null) {
      const leg = sub.legOf.get(selected);
      return new Set(leg ? [selected, ...leg.ids] : [selected]);
    }
    return new Set(
      selected == null
        ? []
        : (runsOf(tree).find((run) => run.terminal === selected)?.path ?? [selected]),
    );
  }, [tree, selected, sub, claimPicked]);
  const readiness = page.group ? ready[page.group] : undefined;
  const shown = hovered ?? selected;
  const pickedIssue = page.issue
    ? (index.snapshot.issues.find((issue) => issue.id === page.issue) ?? null)
    : null;

  const segment = shown == null ? null : view.scene.segments.find((f) => f.segment.id === shown);
  const node = shown == null ? null : view.scene.nodes.find((f) => f.node.id === shown);
  const place = sub && shown != null ? sub.placeOf.get(shown) : undefined;
  const leg = sub && shown != null ? sub.legOf.get(shown) : undefined;
  const meta = sub
    ? [
        `${sub.cut.legs.length} legs`,
        `${sub.cut.nodes.length} places`,
        count(sub.cut.gaps.length, "gap"),
        ...(sub.cut.inferred.length ? [inferredMeta(sub.cut.inferred)] : []),
        ...(sub.cut.omissions.length ? [count(sub.cut.omissions.length, "omission")] : []),
        `${sub.claims.length} claims`,
      ].join(" · ")
    : `${view.scene.segments.length} segments · ${view.scene.issues.length} issues`;

  return (
    <PaneSplit
      axis="horizontal"
      grow
      resize={{ target: "end", defaultSize: 360, minSize: 240, persist: "pe.ducts.factsWidth" }}
      start={
        <Pane id="content" title={view.label} meta={meta} scroll="clip" flush>
          <div className="flex size-full min-h-0 flex-col">
            <div className="flex flex-col gap-1 px-1 py-1">
              <div className="flex flex-wrap items-center gap-1">
                {subject ? (
                  <Switcher
                    ariaLabel="scene"
                    value={page.scene}
                    onChange={(value) =>
                      setPage({
                        scene: value === "subject" ? "subject" : "",
                        selected: "",
                        issue: "",
                      })
                    }
                    options={[
                      {
                        value: "",
                        label: "group",
                        title: "the chosen group at full weight, the rest faint",
                      },
                      {
                        value: "subject",
                        label: "subject",
                        title: "the staged subject cut into legs, with its claims pinned",
                      },
                    ]}
                  />
                ) : null}
                {view.band}
                {sub ? null : readiness ? (
                  <FactChip
                    tone={READY[readiness.level].tone}
                    title={`${READY[readiness.level].note}; open blockers: walking/budget`}
                  >
                    {READY[readiness.level].word} {readiness.walk.length}/{readiness.budget.length}
                  </FactChip>
                ) : (
                  <FactChip title="the drawing shows the document faint until a group is chosen">
                    no group chosen: choose one in the sentence or the tables
                  </FactChip>
                )}
                <GlyphKey />
                <FactChip
                  dashed={!criticalRun}
                  title="Outline marks Pe's critical path once priced, else the longest-run stand-in"
                >
                  {criticalRun
                    ? `outlined: Pe critical path to ${criticalRun.terminal}`
                    : "outlined: longest run (stand-in)"}
                </FactChip>
              </div>
              <div className="flex flex-wrap items-start gap-2" aria-label="encoding">
                <EncodingPicker value={encoding.key} onPick={(key) => setPage({ encoding: key })} />
                <ScaleLegend
                  encoding={encoding}
                  counts={counts}
                  nameOf={nameOfEncoded}
                  onSelect={(id) => setPage({ selected: String(id), issue: "" })}
                />
              </div>
            </div>
            <DuctDrawing
              label={view.label}
              project={view.project}
              scene={view.scene}
              encoding={encoding}
              fitKey={view.fitKey}
              selected={selection}
              critical={sub ? undefined : critical}
              hovered={hovered}
              issue={page.issue}
              claim={claimPicked?.id ?? ""}
              onHover={setHovered}
              onSelect={(id) => setPage({ selected: id == null ? "" : String(id), issue: "" })}
              onSelectClaim={(claim) => setPage({ selected: claim.id, issue: "" })}
              onSelectIssue={(issue) =>
                setPage({
                  issue: issue.id,
                  selected: issue.elementId == null ? "" : String(issue.elementId),
                })
              }
              onDrag={view.onDrag}
              underlay={view.underlay}
              lit={lit} // proto: orbit
            />
            {sub && subject ? (
              <div className="max-h-56 shrink-0 overflow-auto border-t border-line">
                <ClaimsList
                  subject={sub}
                  selected={claimPicked?.id ?? ""}
                  nameOfId={nameOfId}
                  doc={doc}
                  onSelect={(claim) =>
                    setPage({ selected: claim.id === page.selected ? "" : claim.id, issue: "" })
                  }
                  onVerdict={subject.onVerdict}
                  onHover={setHovered}
                  onPick={(id) => setPage({ selected: String(id), issue: "" })}
                />
              </div>
            ) : null}
          </div>
        </Pane>
      }
      end={
        <Pane id="content" title="facts" scroll="auto">
          <div className="flex flex-col gap-3">
            {place ? <PlaceFacts place={place} /> : null}
            {leg ? <LegFacts leg={leg} /> : null}
            {doc && shown != null && (place || leg) ? (
              <ShowInRevit
                doc={doc}
                elementIds={place ? [shown] : leg!.ids}
                what={place ? "place" : "leg"}
              />
            ) : null}
            {sub && claimPicked ? (
              <p data-picked-claim={claimPicked.id}>
                claim <span className="face-mono">{claimPicked.id}</span> ({claimPicked.state}):{" "}
                {claimPicked.text} · at{" "}
                {[...new Set(claimPicked.at.map((id) => nameOf(sub, id)))].join(", ")}
              </p>
            ) : null}
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
            {shown != null && (segment ?? node)?.pressure ? (
              <p data-pe-loss={shown}>
                Pe loss{" "}
                <span className="face-mono">{(segment ?? node)!.pressure!.drop!.toFixed(4)}</span>{" "}
                in-wg
              </p>
            ) : null}
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
