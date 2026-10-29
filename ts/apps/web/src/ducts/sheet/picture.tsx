/**
 * The fan sheet's picture content: the open fan's walk, its blockers and worst path, handed to the
 * route's one `Picture` (selection, pivot, hover, context, layers, readout and pane furniture are
 * its). The focused blocker is the page's `issue`, so a mark picked here focuses its row and a
 * row's hover lights its mark. Rendered through the layout's pane renderer, as `e-picture` is.
 */
import { useMemo } from "react";
import { elementKey, type Members, type SubjectKey } from "@pe/kit/lang/attention";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import { snapshotById } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import {
  idOf,
  Picture,
  type PictureContent,
  type PictureLayer,
  type PictureOverlayFrame,
} from "#/scene/picture/picture";
import { coloursOf } from "../colours";
import { encodingFor } from "../encoding";
import { DuctsOverlay, linesOf, useEquipment } from "../picture-content";
import type { ProtoProps } from "../proto/props";
import { DUCTS_LAYER_OPTIONS } from "../proto/e/teaching";
import { indexOf, sceneOf } from "../scene";
import { paintOfDucts } from "../selection";
import { subjectNamer } from "../subject-text";
import { blockerElements, sheetIssues, sheetLayers } from "./layers";
import type { SheetBlocker } from "./tiers";
import type { OpenSheet } from "./use-sheet";

const NONE: readonly never[] = [];
const NO_IDS: ReadonlySet<number> = new Set();
const fmt = (n: number) => n.toFixed(3);

export function SheetPicture({
  props,
  snapshot,
  sheet,
  blockers,
  renderPane,
}: {
  props: ProtoProps;
  snapshot: DuctSnapshot;
  sheet: OpenSheet | null;
  blockers: readonly SheetBlocker[];
  renderPane: TeachingPaneRender;
}) {
  const { page, setPage, work, priced } = props;
  const worstPathIds = useMemo(
    () => new Set(sheet?.worstLegs.flatMap((path) => path.legs.map((leg) => leg.elementId)) ?? []),
    [sheet],
  );
  // The host follows accepted joins, so walked ids may sit outside the snapshot: capture keys on
  // this set, never on snapshot membership.
  const focusIds = useMemo(
    () =>
      new Set([
        ...(sheet?.elements?.walkedElementIds ?? []),
        ...(sheet?.overview.fan ? [sheet.overview.fan.unitId] : []),
        ...blockers.flatMap(blockerElements),
        ...worstPathIds,
      ]),
    [sheet, blockers, worstPathIds],
  );
  // ponytail: `near` is empty; the sheet exposes no candidate-box context yet.
  const focus = useMemo<PictureContent["focus"]>(
    () => ({ walked: [...focusIds].map((id) => elementKey(id)), near: NONE }),
    [focusIds],
  );
  const members = useMemo<Members>(
    () =>
      new Map<SubjectKey, readonly SubjectKey[]>([
        ...(sheet?.worstLegs ?? []).map(
          (path) =>
            [
              `path:${path.pathId}` as SubjectKey,
              path.legs.map((leg) => elementKey(leg.elementId)),
            ] as const,
        ),
        ...blockers.map(
          (blocker) =>
            [
              `issue:${blocker.id}` as SubjectKey,
              blockerElements(blocker).map((id) => elementKey(id)),
            ] as const,
        ),
      ]),
    [sheet, blockers],
  );
  const scene = useMemo(
    () =>
      sceneOf(
        indexOf(snapshot, priced),
        snapshot.groups.map((g) => g.id),
        () => true,
        focusIds,
      ),
    [snapshot, priced, focusIds],
  );
  const lines = useMemo(() => linesOf(scene), [scene]);
  const routePaint = useMemo(() => paintOfDucts(snapshot, focusIds, NO_IDS), [snapshot, focusIds]);
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
          sheet
            ? sheetLayers({
                snapshot,
                work: work.doc,
                overview: sheet.overview,
                inputs: sheet.inputs,
                blockers,
                meshes,
                worstPathIds,
                focus: focusIds,
              })
            : [],
      },
      ports,
    ],
    [snapshot, work.doc, sheet, blockers, worstPathIds, focusIds, ports],
  );
  const issues = useMemo(() => sheetIssues(blockers, null), [blockers]);
  const byId = useMemo(() => snapshotById(snapshot), [snapshot]);
  const nameOf = useMemo(() => subjectNamer(snapshot), [snapshot]);
  const encoding = useMemo(() => encodingFor("none"), []);
  const pointOf = (id: number): readonly number[] | null => {
    const node = byId.nodes.get(id);
    if (node) return node.point;
    const line = byId.segments.get(id)?.polyline;
    return line ? (line[Math.floor((line.length - 1) / 2)] ?? null) : null;
  };
  const marksOn = new Set<string>(page.layers);
  const overlay = (frame: PictureOverlayFrame) => (
    <DuctsOverlay
      frame={frame}
      scene={scene}
      layers={marksOn}
      encoding={encoding}
      labels={NONE}
      rulings={NONE}
      covered={NONE}
      issues={issues}
      pointOf={pointOf}
      issue={page.issue}
      onRuling={() => {}}
    />
  );
  const fan = sheet?.overview.fan;
  // With no fan open there is nothing to capture; say what to do instead of the network picture's words.
  if (!fan)
    return renderPane(
      <p className="t-small p-3 text-ink-2" data-sheet-picture="">
        Open a fan from the Fans list to draw its walk.
      </p>,
      { meta: "no fan open" },
    );
  const esp = sheet.overview.totals?.requiredEspInWg ?? null;
  const summary = (
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
        refreshing: props.reading.refreshing,
      }}
      page={page}
      setPage={setPage}
      renderPane={renderPane}
      onPose={props.onPose}
      content={{
        focus,
        members,
        lines,
        name: (key) => nameOf(idOf(key)) ?? "element not in snapshot",
        paint,
        kinds,
        colour,
        layers,
        layerOptions: DUCTS_LAYER_OPTIONS,
        overlay,
        readout: { subject: fan.mark, summary },
      }}
    />
  );
}
