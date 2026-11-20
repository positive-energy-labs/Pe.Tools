/**
 * The fan sheet's walk as picture parts: the open fan's strands, its blocker skins and worst path,
 * its captions and its readout, handed to the kernel's picture pane through the /fans picture slot's
 * overlay (`fans/picture.tsx`). The pane owns the picture: capture, pose, selection, marks, findings.
 * The focused blocker is the page's `issue`, so a mark picked here focuses its row and a row's hover
 * lights its mark.
 */
import { useElementAttention } from "@pe/web-kernel/attention";
import {
  layersOn,
  type PictureLayer,
  type PictureOverlayFrame,
  type PictureStrand,
} from "@pe/web-kernel/scene/picture/content";
import type { PictureParts } from "@pe/web-kernel/route/slots/picture/overlay";
import { useAdmittedSubject } from "@pe/web-kernel/shell/subject";
import type { PicturePage } from "@pe/agent-contracts";
import { snapshotById } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Members, SubjectKey } from "@pe/kit/lang/attention";
import type { ElementIndex } from "@pe/web-kernel/element-index";
import { ductElements } from "@pe/ducts-web/identity";
import { useMemo, type ReactNode, type RefObject } from "react";
import { coloursOf } from "@pe/ducts-web/colours";
import { NodeFactsView, SegmentFactsView } from "@pe/ducts-web/facts";
import { EncodingPicker } from "@pe/ducts-web/encoding/picker";
import { ScaleLegend } from "@pe/ducts-web/encoding/scale-legend";
import { flowDirections } from "@pe/ducts-web/encoding/flow";
import { encodingFor } from "@pe/ducts-web/encoding";
import type { OpenCalc } from "./types.ts";
import { DuctsOverlay, linesOf, useEquipment } from "@pe/ducts-web/picture-content";
import { GoToSubject } from "@pe/ducts-web/screen/go-to";
import { DUCTS_LAYER_OPTIONS } from "@pe/ducts-web/picture-options";
import { indexOf, sceneOf } from "@pe/ducts-web/scene";
import { paintOfDucts } from "@pe/ducts-web/selection";
import { subjectNamer } from "@pe/ducts-web/subject-text";
import type { LossesWork } from "@pe/ducts-web/work";
import { blockerElements, calcIssues, calcLayers } from "./layers.ts";
import type { Detail, FanPort } from "@pe/ducts-web/calc/model";
import type { CalcBlocker } from "./tiers.ts";
export interface CalcPictureProps {
  /** What the walk reads of the kernel's pose: the layers on, how context draws, the encoding, and the focused blocker. */
  page: Pick<PicturePage, "layers" | "context" | "encoding" | "issue">;
  /** Writes pose fields through the Page; the kernel pane owns every other pose write. */
  pose(patch: Partial<Pick<PicturePage, "layers" | "encoding">>): void;
  /** Selects a subject named in text (the legend's maximum). */
  select(key: SubjectKey): void;
  work: Pick<LossesWork, "doc">;
  /** The snapshot's model revision and whether its read is current: what the capture follows. */
  source: { version: string; current: boolean };
}

/** The fan sheet's layer strip: the duct walk's, without the network's no-run branches, plus the sheet's own blockers.
 * `findings` is the kernel's: the document's findings Work, never the sheet's computed blockers. */
export const FAN_LAYER_OPTIONS = [
  ...DUCTS_LAYER_OPTIONS.filter((option) => option.key !== "no-run"),
  { key: "blockers" as const, label: "blockers" },
];

const NONE: readonly never[] = [];

/**
 * The worksheet as picture content (ducts LEDGER 2026-10-29): every terminal run is a strand in
 * air order (a return run is walked fan to grille, so it reverses), the critical run heavy; `over`
 * is every leg past its velocity limit; runs and sections register as groups; a picked element
 * widens to its first section, the one under the critical run.
 */
export function calcBreakdownPicture(ws: Detail<"worksheet"> | null, elements: ElementIndex) {
  const members = new Map<SubjectKey, readonly SubjectKey[]>();
  const strands: PictureStrand[] = [];
  const over = new Set<SubjectKey>();
  const sectionOf = new Map<SubjectKey, SubjectKey>();
  if (!ws) return { members, strands, over, widen: undefined };
  const keyOf = (legId: string) => {
    const leg = ws.legs[legId];
    return leg ? elements.keyOf(leg.elementId) : null;
  };
  const keys = (legIds: readonly string[]) =>
    legIds.map(keyOf).filter((k): k is SubjectKey => k != null);
  for (const side of ["supply", "return"] as const) {
    for (const run of ws[side].runs) {
      const path = keys(run.legIds);
      if (side === "return") path.reverse();
      strands.push({ key: `run:${run.id}`, path, heavy: run.critical });
      members.set(`run:${run.id}`, path);
      for (const k of keys(run.overLegIds)) over.add(k);
    }
    for (const section of ws[side].sections)
      members.set(`section:${section.id}`, keys(section.legIds));
    for (const [elementId, sections] of Object.entries(ws[side].elementSections)) {
      const key = elements.keyOf(Number(elementId));
      if (key && sections[0] && !sectionOf.has(key)) sectionOf.set(key, `section:${sections[0]}`);
    }
  }
  const widen = (key: SubjectKey) => {
    const section = sectionOf.get(key);
    return section ? (members.get(section) ?? NONE) : NONE;
  };
  return { members, strands, over, widen };
}
const fmt = (n: number) => n.toFixed(3);
type Beyond = NonNullable<OpenCalc["elements"]>["beyond"];
const NO_BEYOND: Beyond = [];

/** What a context element past a stopping unit says wherever it is named: whose air it is, and that this fan's calc leaves it out. */
export const beyondWords = (mark: string) => `beyond ${mark} (its own fan); not in this fan's calc`;

/**
 * Beyond as picture content (kaitpw 2026-10-30, "yes show"): a short stub from every port of each
 * unit this fan stops at, by id, with that unit's mark, drawn while context is (the `halo` or
 * `context` layer, the picture's own rule). It joins the capture as `near`, cut where the host cut
 * it, and paints as a one-hop neighbour stub, the network stage's mark for a network that is not
 * the one open; it is never walked, so no strand, finding or total stands on it.
 */
export function beyondPicture(beyond: Beyond, walked: ReadonlySet<number>, on: boolean) {
  const markOf = new Map<number, string>();
  const cuts = new Map<number, Beyond[number]["cuts"]>();
  if (on)
    for (const unit of beyond) {
      for (const id of unit.elementIds)
        if (!walked.has(id) && !markOf.has(id)) markOf.set(id, unit.mark);
      for (const cut of unit.cuts)
        if (markOf.get(cut.id) === unit.mark) cuts.set(cut.id, [...(cuts.get(cut.id) ?? []), cut]);
    }
  return { markOf, cuts, ids: new Set(markOf.keys()) as ReadonlySet<number> };
}

/**
 * The stub captions past each stopping unit: one per unit, not one per element (drive 10: about 20
 * copies of one sentence swamped the picture). It sits on the unit's first element with a point and
 * carries every such element's id, so the caption anchors on the nearest cut and any of them lights it.
 */
export const beyondLabels = (
  markOf: ReadonlyMap<number, string>,
  pointOf: (id: number) => readonly number[] | null,
) => {
  const byMark = new Map<string, { at: readonly number[]; ids: number[] }>();
  for (const [id, mark] of markOf) {
    const at = pointOf(id);
    if (!at) continue;
    const unit = byMark.get(mark);
    if (unit) unit.ids.push(id);
    else byMark.set(mark, { at, ids: [id] });
  }
  return [...byMark].map(([mark, { at, ids }]) => ({
    key: `beyond:${mark}`,
    at,
    text: beyondWords(mark),
    priced: false,
    ids,
    stub: true,
  }));
};

export function CalcPicture({
  props,
  snapshot,
  sheet,
  blockers,
  picture,
  jump,
  opened,
  fans,
  systemFans,
}: {
  props: CalcPictureProps;
  snapshot: DuctSnapshot;
  opened?: readonly OpenCalc[];
  fans?: readonly FanPort[];
  /** The subject ids of a system's fans: what a go-to system pick adds. */
  systemFans: (system: string) => readonly unknown[];
  sheet: OpenCalc | null;
  blockers: readonly CalcBlocker[];
  /** The kernel pane's draw: these parts over its picture. */
  picture(parts: PictureParts): ReactNode;
  /** Filled by the picture: a footnote press selects and flies to its subject. */
  jump?: RefObject<((key: SubjectKey) => void) | null>;
}) {
  const { page, work } = props;
  const elements = useMemo(() => ductElements(snapshot), [snapshot]);
  const subject = useAdmittedSubject();
  const overviewFans =
    fans ??
    (opened ?? (sheet ? [sheet] : [])).flatMap((item) =>
      item.overview.fan ? [item.overview.fan] : [],
    );
  const worstPathIds = useMemo(
    () => new Set(sheet?.worstLegs.flatMap((path) => path.legs.map((leg) => leg.elementId)) ?? []),
    [sheet],
  );
  // The host follows accepted joins, so walked ids may sit outside the snapshot: capture keys on
  // this set, never on snapshot membership.
  const focusIds = useMemo(
    () =>
      new Set([
        ...overviewFans.map((fan) => fan.unitId),
        ...(opened ?? (sheet ? [sheet] : [])).flatMap(
          (item) => item.elements?.walkedElementIds ?? [],
        ),
        ...(opened ?? (sheet ? [sheet] : [])).flatMap((item) =>
          item.overview.fan ? [item.overview.fan.unitId] : [],
        ),
        ...blockers.flatMap(blockerElements),
        ...worstPathIds,
      ]),
    [sheet, opened, fans, blockers, worstPathIds],
  );
  const on = layersOn(page.layers, FAN_LAYER_OPTIONS);
  const contextOn = page.context !== "off";
  const beyond = useMemo(
    () => beyondPicture(sheet?.elements?.beyond ?? NO_BEYOND, focusIds, contextOn),
    [sheet, focusIds, contextOn],
  );
  // `near` is the context past each stopping unit; the sheet exposes no candidate-box context yet.
  const focus = useMemo<NonNullable<PictureParts["focus"]>>(
    () => ({
      walked: [...focusIds],
      near: [...beyond.ids],
    }),
    [focusIds, beyond],
  );
  const runs = useMemo(
    () => calcBreakdownPicture(sheet?.calcBreakdown ?? null, elements),
    [sheet, elements],
  );
  const members = useMemo<Members>(
    () =>
      new Map<SubjectKey, readonly SubjectKey[]>([
        ...runs.members,
        ...(sheet?.worstLegs ?? []).map(
          (path) =>
            [
              `path:${path.pathId}`,
              elements.keysOf(path.legs.map((leg) => leg.elementId)),
            ] as const,
        ),
        ...blockers.map(
          (blocker) => [`issue:${blocker.id}`, elements.keysOf(blockerElements(blocker))] as const,
        ),
      ]),
    [sheet, blockers, runs, elements],
  );
  const baseScene = useMemo(
    () =>
      sceneOf(
        indexOf(snapshot, null),
        snapshot.groups.map((g) => g.id),
        () => true,
        focusIds,
      ),
    [snapshot, focusIds],
  );
  const legs = useMemo(() => Object.values(sheet?.calcBreakdown?.legs ?? {}), [sheet]);
  const legsByElement = useMemo(() => {
    const index = new Map<number, typeof legs>();
    for (const leg of legs) index.set(leg.elementId, [...(index.get(leg.elementId) ?? []), leg]);
    return index;
  }, [legs]);
  const scene = useMemo(() => {
    const pressure = (id: number) => {
      const own = legsByElement.get(id) ?? [];
      const losses = own.flatMap((leg) => (leg.lossInWg == null ? [] : [leg.lossInWg]));
      return losses.length && losses.length === own.length
        ? { drop: Math.max(...losses) }
        : undefined;
    };
    return {
      ...baseScene,
      segments: baseScene.segments.map((facts) => ({
        ...facts,
        pressure: pressure(facts.segment.id),
      })),
      nodes: baseScene.nodes.map((facts) => ({ ...facts, pressure: pressure(facts.node.id) })),
    };
  }, [baseScene, legsByElement]);
  const lines = useMemo(() => linesOf(scene, elements), [scene, elements]);
  const routePaint = useMemo(
    () => paintOfDucts(snapshot, focusIds, beyond.ids),
    [snapshot, focusIds, beyond],
  );
  const kinds = coloursOf(work.doc);
  const colour = on.includes("system-colours") ? "firm" : "mono";
  const { paint, ports } = useEquipment(scene, routePaint, kinds, colour);
  const layers = useMemo<PictureLayer[]>(
    () => [
      // The sheet's marks are its computed blockers: the `blockers` layer shows and hides them.
      {
        key: "sheet",
        toggle: "blockers",
        draw: ({ meshes }) =>
          (opened ?? (sheet ? [sheet] : [])).flatMap((item) =>
            calcLayers({
              snapshot,
              work: work.doc,
              overview: item.overview,
              inputs: item.inputs,
              blockers,
              meshes,
              worstPathIds,
              focus: focusIds,
            }),
          ),
      },
      ports,
    ],
    [snapshot, work.doc, sheet, opened, blockers, worstPathIds, focusIds, ports],
  );
  const issues = useMemo(() => calcIssues(blockers, null), [blockers]);
  const byId = useMemo(() => snapshotById(snapshot), [snapshot]);
  const namer = useMemo(() => subjectNamer(snapshot), [snapshot]);
  const nameOf = (id: number) => {
    const mark = beyond.markOf.get(id);
    const name = namer(id);
    return mark ? `${name} · ${beyondWords(mark)}` : name;
  };
  // Hovering a context element names it in the readout (no tooltip): whose air it is.
  const { hovered } = useElementAttention();
  const hoveredBeyond = hovered != null && beyond.markOf.has(hovered) ? hovered : null;
  const encoding = useMemo(() => {
    const directions = new Map(snapshot.groups.flatMap((g) => [...flowDirections(snapshot, g.id)]));
    const value = encodingFor(page.encoding, scene, directions);
    return page.encoding === "legs"
      ? {
          ...value,
          bin: (facts: { segment?: { id: number } }) =>
            legs.some((leg) => leg.elementId === facts.segment?.id) ? "leg" : "off",
        }
      : value;
  }, [page.encoding, scene, snapshot]);
  const counts = new Map<string, number>();
  for (const facts of [...scene.segments, ...(encoding.nodes ? scene.nodes : [])]) {
    const key = encoding.bin(facts);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const pointOf = (id: number): readonly number[] | null => {
    const node = byId.nodes.get(id);
    if (node) return node.point ?? null;
    const line = byId.segments.get(id)?.polyline;
    return line ? (line[Math.floor((line.length - 1) / 2)] ?? null) : null;
  };
  // The DOM marks' own word for the issues they are handed is `findings`; here those are the sheet's blockers.
  const marksOn = new Set<string>([
    ...on.filter((key) => key !== "findings"),
    ...(on.includes("blockers") ? ["findings"] : []),
  ]);
  const labels = scene.nodes.flatMap(({ node }) =>
    node.point
      ? [
          {
            key: `element:${node.id}`,
            at: node.point,
            text: nameOf(node.id),
            priced: false,
            ids: [node.id],
          },
        ]
      : [],
  );
  const stubLabels = beyondLabels(beyond.markOf, pointOf);
  const overlay = (frame: PictureOverlayFrame) => (
    <DuctsOverlay
      frame={frame}
      scene={scene}
      layers={marksOn}
      encoding={encoding}
      labels={[...labels, ...stubLabels]}
      rulings={NONE}
      covered={NONE}
      issues={issues}
      pointOf={pointOf}
      issue={page.issue}
      onRuling={() => {}}
    />
  );
  const sides = [sheet?.calcBreakdown?.supply, sheet?.calcBreakdown?.return];
  const runFor = (key: SubjectKey) =>
    sides.flatMap((side) => side?.runs ?? []).find((run) => `run:${run.id}` === key);
  const fan = overviewFans[0];
  // With no fan open there is nothing to capture; say what to do instead of the network picture's words.
  if (!fan)
    return (
      <p className="t-small p-3 text-ink-2" data-calc-picture="">
        Pick a fan in the Fans list, or choose one in its header, to draw its walk.
      </p>
    );
  const esp = sheet?.overview.totals?.requiredEspInWg ?? null;
  const summary =
    hoveredBeyond != null ? (
      <span data-calc-picture-beyond="" className="text-ink-2">
        {nameOf(hoveredBeyond)}
      </span>
    ) : (
      <span data-calc-picture-state="">
        {fan.mark} · port {fan.portIndex} ·{" "}
        {esp == null ? (
          // An incomplete sheet has no required ESP: missing reads as missing, never a number.
          <span className="text-ink-2">incomplete: no required ESP</span>
        ) : (
          <>
            required ESP <span className="face-mono">{fmt(esp)} in-wg</span>
          </>
        )}{" "}
        · {blockers.length} blocker{blockers.length === 1 ? "" : "s"}
        {blockers
          .filter((b) => b.kind === "backflow")
          .map((b) => (
            <span key={b.id} data-tone="caution">
              {" "}
              · {b.detail}
            </span>
          ))}
      </span>
    );
  return picture({
    source: props.source,
    label: "fan sheet",
    jump,
    focus,
    members,
    // Ruling C: hovering an element lights its section; a pick selects that section.
    hoverGroups: (group) => group.startsWith("section:"),
    widen: runs.widen,
    strands: runs.strands,
    over: runs.over,
    lines,
    name: (key) =>
      key.startsWith("run:")
        ? `Run to ${nameOf(runFor(key)?.end.elementId ?? NaN)}`
        : key.startsWith("section:")
          ? `Section ${key.slice(8)}`
          : (nameOf(elements.idOf(key)) ?? "element not in snapshot"),
    paint,
    kinds,
    colour,
    layers,
    layerOptions: FAN_LAYER_OPTIONS,
    capture: { cuts: beyond.cuts },
    overlay,
    readout: {
      subject: fan.mark,
      summary,
      facts: (key) => {
        const run = runFor(key);
        const section = sides
          .flatMap((side) => side?.sections ?? [])
          .find((part) => `section:${part.id}` === key);
        const path = run ?? section;
        if (path)
          return (
            <dl data-run-facts={run?.id} data-section-facts={section?.id}>
              <dt>
                {path.side} {run ? "run" : "section"} {run?.critical ? "· critical" : ""}
              </dt>
              <dd className="face-mono">
                {path.cfm ?? "missing"} cfm · {path.telFt.toFixed(1)} eq ft
              </dd>
              <dd className="face-mono">
                {path.knownInWg.toFixed(4)} in-wg known ·{" "}
                {run
                  ? run.complete
                    ? "complete"
                    : "incomplete"
                  : `${section?.unpricedLegs ?? 0} unpriced legs`}
              </dd>
              <dd>
                {path.legIds.length} legs · max {path.maxFpm ?? "missing"} fpm
              </dd>
            </dl>
          );
        const id = elements.idOf(key);
        const segment = baseScene.segments.find((f) => f.segment.id === id);
        const node = scene.nodes.find((f) => f.node.id === id);
        return (
          <>
            {segment ? (
              <SegmentFactsView {...segment} />
            ) : node ? (
              <NodeFactsView {...node} />
            ) : (
              <p>Element {id} is outside the snapshot</p>
            )}
            {legs
              .filter((leg) => leg.elementId === id)
              .map((leg) => (
                <dl key={leg.id} data-leg-facts={leg.id}>
                  <dt>Calc leg · {leg.flowSource ?? "flow source missing"}</dt>
                  <dd className="face-mono">
                    {leg.flowCfm ?? "missing"} cfm · {leg.velocityFpm ?? "missing"} fpm
                  </dd>
                  <dd className="face-mono">
                    {leg.lossInWg == null ? "missing" : leg.lossInWg.toFixed(4)} in-wg ·{" "}
                    {leg.lossSource.kind}: {leg.lossSource.ref}
                  </dd>
                </dl>
              ))}
          </>
        );
      },
    },
    furniture: {
      actions: (
        <EncodingPicker
          value={encoding.key}
          onPick={(encoding) =>
            props.pose({ encoding, layers: [...new Set([...on, "centrelines" as const])] })
          }
        />
      ),
      legend: (
        <ScaleLegend
          encoding={encoding}
          counts={counts}
          nameOf={nameOf}
          onSelect={(id) => {
            const key = elements.keyOf(id);
            if (key) props.select(key);
          }}
        />
      ),
    },
    goTo: (jumpTo) => (
      <GoToSubject
        snapshot={snapshot}
        here={focusIds}
        opens={(system) => systemFans(system).length > 0}
        nameOf={namer}
        onGo={({ system, id }) => {
          const key = id == null ? null : elements.keyOf(id);
          if (id == null) subject?.add(systemFans(system));
          else if (key) jumpTo(key);
        }}
      />
    ),
  });
}
