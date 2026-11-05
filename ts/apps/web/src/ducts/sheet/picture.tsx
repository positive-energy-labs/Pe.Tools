/**
 * The fan sheet's picture content: the open fan's walk, its blockers and worst path, handed to the
 * route's one `Picture` (selection, pivot, hover, context, layers, readout and pane furniture are
 * its). The focused blocker is the page's `issue`, so a mark picked here focuses its row and a
 * row's hover lights its mark. Rendered through the layout's pane renderer, as `e-picture` is.
 */
import { useElementAttention } from "#/attention";
import { sceneRequest } from "#/scene/host";
import {
  idOf,
  Picture,
  type PictureContent,
  type PictureLayer,
  type PictureOverlayFrame,
  type PictureStrand,
} from "#/scene/picture/picture";
import { useAdmittedSubject } from "#/shell/subject";
import type { OrbitViewport, PicturePage } from "@pe/agent-contracts";
import { snapshotById } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { elementKey, type Members, type SubjectKey } from "@pe/kit/lang/attention";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import type * as Atom from "effect/reactivity/Atom";
import { useMemo, type RefObject } from "react";
import { coloursOf } from "../colours";
import { NodeFactsView, SegmentFactsView } from "../facts";
import { EncodingPicker } from "../proto/encoding/picker";
import { ScaleLegend } from "../proto/encoding/scale-legend";
import { flowDirections } from "../proto/encoding/flow";
import { encodingFor } from "../encoding";
import type { OpenSheet } from "../neutral.ts";
import { DuctsOverlay, linesOf, useEquipment } from "../picture-content";
import { GoToSubject } from "../proto/e/go-to";
import { DUCTS_LAYER_OPTIONS } from "../proto/e/teaching";
import { indexOf, sceneOf } from "../scene";
import { paintOfDucts } from "../selection";
import { subjectNamer } from "../subject-text";
import type { LossesWork } from "../work";
import { blockerElements, sheetIssues, sheetLayers } from "./layers";
import type { Detail, FanPort } from "./model";
import type { SheetBlocker } from "./tiers";
export interface SheetPictureProps {
  page: PicturePage<string, "schematic">;
  setPage(
    next: Partial<PicturePage<string, "schematic">>,
    move?: { readonly history?: "push" | "replace" },
  ): void;
  work: Pick<LossesWork, "doc">;
  selection: Atom.Atom<ReadonlySet<SubjectKey>>;
  captureSource?: { document: { session: string; openId: string }; version: string } | null;
  doc: { session: string; openId: string } | null;
  refreshing: boolean;
  onPose?: (pose: OrbitViewport | null) => void;
}

const NONE: readonly never[] = [];

/**
 * The worksheet as picture content (ducts LEDGER 2026-10-29): every terminal run is a strand in
 * air order (a return run is walked fan to grille, so it reverses), the critical run heavy; `over`
 * is every leg past its velocity limit; runs and sections register as groups; a picked element
 * widens to its first section, the one under the critical run.
 */
export function worksheetPicture(ws: Detail<"worksheet"> | null) {
  const members = new Map<SubjectKey, readonly SubjectKey[]>();
  const strands: PictureStrand[] = [];
  const over = new Set<SubjectKey>();
  const sectionOf = new Map<SubjectKey, SubjectKey>();
  if (!ws) return { members, strands, over, widen: undefined };
  const keyOf = (legId: string) => {
    const leg = ws.legs[legId];
    return leg ? elementKey(leg.elementId) : null;
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
    for (const [elementId, sections] of Object.entries(ws[side].elementSections))
      if (sections[0] && !sectionOf.has(elementKey(Number(elementId))))
        sectionOf.set(elementKey(Number(elementId)), `section:${sections[0]}`);
  }
  const widen = (key: SubjectKey) => {
    const section = sectionOf.get(key);
    return section ? (members.get(section) ?? NONE) : NONE;
  };
  return { members, strands, over, widen };
}
const fmt = (n: number) => n.toFixed(3);
type Beyond = NonNullable<OpenSheet["elements"]>["beyond"];
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

export function SheetPicture({
  props,
  snapshot,
  sheet,
  blockers,
  renderPane,
  jump,
  opened,
  fans,
  systemFans,
}: {
  props: SheetPictureProps;
  snapshot: DuctSnapshot;
  opened?: readonly OpenSheet[];
  fans?: readonly FanPort[];
  /** The subject ids of a system's fans: what a go-to system pick adds. */
  systemFans: (system: string) => readonly unknown[];
  sheet: OpenSheet | null;
  blockers: readonly SheetBlocker[];
  renderPane: TeachingPaneRender;
  /** Filled by the picture: a footnote press selects and flies to its subject. */
  jump?: RefObject<((key: SubjectKey) => void) | null>;
}) {
  const { page, setPage, work } = props;
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
  const contextOn = page.layers.includes("context") || page.layers.includes("halo");
  const beyond = useMemo(
    () => beyondPicture(sheet?.elements?.beyond ?? NO_BEYOND, focusIds, contextOn),
    [sheet, focusIds, contextOn],
  );
  // `near` is the context past each stopping unit; the sheet exposes no candidate-box context yet.
  const focus = useMemo<PictureContent["focus"]>(
    () => ({
      walked: [...focusIds].map((id) => elementKey(id)),
      near: [...beyond.ids].map((id) => elementKey(id)),
    }),
    [focusIds, beyond],
  );
  const runs = useMemo(() => worksheetPicture(sheet?.worksheet ?? null), [sheet]);
  const members = useMemo<Members>(
    () =>
      new Map<SubjectKey, readonly SubjectKey[]>([
        ...runs.members,
        ...(sheet?.worstLegs ?? []).map(
          (path) =>
            [`path:${path.pathId}`, path.legs.map((leg) => elementKey(leg.elementId))] as const,
        ),
        ...blockers.map(
          (blocker) =>
            [`issue:${blocker.id}`, blockerElements(blocker).map((id) => elementKey(id))] as const,
        ),
      ]),
    [sheet, blockers, runs],
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
  const legs = useMemo(() => Object.values(sheet?.worksheet?.legs ?? {}), [sheet]);
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
  const lines = useMemo(() => linesOf(scene), [scene]);
  const routePaint = useMemo(
    () => paintOfDucts(snapshot, focusIds, beyond.ids),
    [snapshot, focusIds, beyond],
  );
  const kinds = coloursOf(work.doc);
  const colour = page.layers.includes("system-colours") ? "firm" : "mono";
  const { paint, ports } = useEquipment(scene, routePaint, kinds, colour);
  const layers = useMemo<PictureLayer[]>(
    () => [
      // The sheet's marks are its findings: the `findings` layer shows and hides them.
      {
        key: "sheet",
        toggle: "findings",
        draw: ({ meshes }) =>
          (opened ?? (sheet ? [sheet] : [])).flatMap((item) =>
            sheetLayers({
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
  const issues = useMemo(() => sheetIssues(blockers, null), [blockers]);
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
  const marksOn = new Set<string>(page.layers);
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
  const stubLabels = [...beyond.markOf].flatMap(([id, mark]) => {
    const at = pointOf(id);
    return at
      ? [{ key: `beyond:${id}`, at, text: beyondWords(mark), priced: false, ids: [id], stub: true }]
      : [];
  });
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
      issue={page.selected}
      onRuling={() => {}}
    />
  );
  const sides = [sheet?.worksheet?.supply, sheet?.worksheet?.return];
  const runFor = (key: SubjectKey) =>
    sides.flatMap((side) => side?.runs ?? []).find((run) => `run:${run.id}` === key);
  const fan = overviewFans[0];
  // With no fan open there is nothing to capture; say what to do instead of the network picture's words.
  if (!fan)
    return renderPane(
      <p className="t-small p-3 text-ink-2" data-sheet-picture="">
        Pick a fan in the Fans list, or choose one in its header, to draw its walk.
      </p>,
      { meta: "no fan open" },
    );
  const esp = sheet?.overview.totals?.requiredEspInWg ?? null;
  const summary =
    hoveredBeyond != null ? (
      <span data-sheet-picture-beyond="" className="text-ink-2">
        {nameOf(hoveredBeyond)}
      </span>
    ) : (
      <span data-sheet-picture-state="">
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
      </span>
    );
  return (
    <Picture
      selection={props.selection}
      source={{
        native: props.captureSource?.document ?? null,
        doc: props.doc,
        version: props.captureSource?.version ?? "",
        label: "fan sheet",
        refreshing: props.refreshing,
      }}
      page={{ ...page, issue: page.selected }}
      setPage={setPage}
      renderPane={renderPane}
      onPose={props.onPose}
      jump={jump}
      content={{
        geometry: {
          overview: sceneRequest(
            [...new Set(overviewFans.map((fan) => fan.unitId))],
            false,
            0,
            "overview",
          ),
        },
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
              : (nameOf(idOf(key)) ?? "element not in snapshot"),
        paint,
        kinds,
        colour,
        layers,
        // The worksheet has no old network "no-run" overlay; do not advertise an inert layer.
        layerOptions: DUCTS_LAYER_OPTIONS.filter((option) => option.key !== "no-run"),
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
            const id = idOf(key);
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
                      <dt>Sheet leg · {leg.flowSource ?? "flow source missing"}</dt>
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
                setPage(
                  { encoding, layers: [...new Set([...page.layers, "centrelines"])] },
                  { history: "push" },
                )
              }
            />
          ),
          legend: (
            <ScaleLegend
              encoding={encoding}
              counts={counts}
              nameOf={nameOf}
              onSelect={(id) => setPage({ selected: String(id) }, { history: "push" })}
            />
          ),
        },
        goTo: (jumpTo) => (
          <GoToSubject
            snapshot={snapshot}
            here={focusIds}
            opens={(system) => systemFans(system).length > 0}
            nameOf={namer}
            onGo={({ system, id }) =>
              id == null ? subject?.add(systemFans(system)) : jumpTo(elementKey(id))
            }
          />
        ),
      }}
    />
  );
}
