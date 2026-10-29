/**
 * The /ducts picture over the open sheet's walked elements with the sheet's layers: the same
 * `ModelPicture` (hover, click, double-click frame, right-click menu, readout, section) under a
 * `PictureStage`, never a second viewer. The focused blocker is the page's `issue`, so a mark
 * picked here focuses its row and a row's hover lights its mark. Rendered through the layout's
 * pane renderer (`renderPane`, as `e-picture` does) so the house picture strip owns the frame.
 */
import { useEffect, useMemo, useState } from "react";
import { useElementAttention, useHoveredIssue, useIssueHover } from "#/attention";
import { useDuctScene, usePictureRead } from "#/ducts/scene-read";
import { useLiveOrbit } from "@pe/kit/lang/live-orbit";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import { snapshotById } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { sceneRequest } from "#/scene/host";
import { PictureStage, stageViewport } from "#/scene/stage-controller";
import { coloursOf } from "../colours";
import { encodingFor } from "../encoding";
import { boundsOfIds, ModelPicture, poseOf, usePictureBounds } from "../model-picture";
import { indexOf, sceneOf } from "../scene";
import type { ProtoProps } from "../proto/props";
import { blockerElements, sheetIssues, sheetLayers } from "./layers";
import type { SheetBlocker } from "./tiers";
import type { OpenSheet } from "./use-sheet";

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
  const { page, setPage, work, priced, onSelect } = props;
  const { hovered, lit, selected } = useElementAttention();
  const hoveredIssue = useHoveredIssue();
  const onIssueHover = useIssueHover();
  const worstPathIds = useMemo(
    () => new Set(sheet?.worstLegs.flatMap((path) => path.legs.map((leg) => leg.elementId)) ?? []),
    [sheet],
  );
  const focus = useMemo(
    () =>
      new Set([
        ...(sheet?.elements?.walkedElementIds ?? []),
        ...(sheet?.overview.fan ? [sheet.overview.fan.unitId] : []),
        ...blockers.flatMap(blockerElements),
        ...worstPathIds,
      ]),
    [sheet, blockers, worstPathIds],
  );
  const request = useMemo(() => (focus.size ? sceneRequest([...focus], true) : null), [focus]);
  const native = props.captureSource?.document ?? null;
  const capture = useDuctScene(request, native, props.captureSource?.version ?? "");
  const pictureDocument = native ?? props.doc;
  const pictureKey =
    pictureDocument && request ? `${pictureDocument.session}/${pictureDocument.openId}` : null;
  const { read } = usePictureRead(capture, pictureKey, "fan sheet", props.reading.refreshing);
  const scene = useMemo(
    () =>
      sceneOf(
        indexOf(snapshot, priced),
        snapshot.groups.map((g) => g.id),
        () => true,
        focus,
      ),
    [snapshot, priced, focus],
  );
  const bounds = usePictureBounds(read.meshes, scene);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize(width > 0 && height > 0 ? { width, height } : null);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);
  const pose = useMemo(() => poseOf(page.viewport, bounds, size), [page.viewport, bounds, size]);
  const orbit = useLiveOrbit(
    pose,
    stageViewport(setPage),
    `${pictureKey}/sheet`,
    page.viewport,
    bounds?.scene,
  );
  const layers = useMemo(
    () =>
      sheet
        ? sheetLayers({
            snapshot,
            work: work.doc,
            overview: sheet.overview,
            inputs: sheet.inputs,
            blockers,
            meshes: read.meshes,
            worstPathIds,
            focus,
          })
        : [],
    [snapshot, work.doc, sheet, blockers, read.meshes, worstPathIds, focus],
  );
  const issues = useMemo(() => sheetIssues(blockers, null), [blockers]);
  const byId = useMemo(() => snapshotById(snapshot), [snapshot]);
  const pointOf = (id: number): readonly number[] | null => {
    const node = byId.nodes.get(id);
    if (node) return node.point;
    const line = byId.segments.get(id)?.polyline;
    return line ? (line[Math.floor((line.length - 1) / 2)] ?? null) : null;
  };
  const encoding = useMemo(() => encodingFor("none"), []);
  const clear = () => {
    if (page.selected || page.issue) setPage({ selected: "", issue: "" }, { history: "push" });
  };
  const fan = sheet?.overview.fan;
  // With no fan open there is nothing to capture; say what to do instead of the network picture's words.
  if (!fan)
    return renderPane(
      <p className="t-small p-3 text-ink-2" data-sheet-picture="">
        Open a fan from the Fans list to draw its walk.
      </p>,
      { meta: "no fan open" },
    );
  return renderPane(
    <div ref={setHost} className="relative size-full min-h-0 min-w-0" data-sheet-picture="">
      <PictureStage
        goTo={null}
        kind="orbit"
        orbit={orbit}
        bounds={bounds}
        host={host}
        selectedBounds={boundsOfIds(read.meshes, scene, selected)}
        clearSelection={clear}
      >
        <ModelPicture
          readout={null}
          read={read}
          bounds={bounds}
          orbit={orbit}
          scene={scene}
          layers={new Set(page.layers)}
          encoding={encoding}
          selected={selected}
          lit={lit}
          hovered={hovered}
          labels={[]}
          rulings={[]}
          findings3d={layers}
          issues={issues}
          hoveredIssue={hoveredIssue}
          onIssueHover={onIssueHover}
          pointOf={pointOf}
          issue={page.issue}
          setPage={setPage}
          onPick={(id) => onSelect(id)}
          onClear={clear}
          onRuling={() => {}}
          kinds={coloursOf(work.doc)}
          colour="mono"
          sceneView={page.sceneView}
          contextMode="off"
        />
      </PictureStage>
    </div>,
    {
      meta: fan ? `${fan.mark} · port ${fan.portIndex} · ${blockers.length} blockers` : "no fan open",
      legend: null,
    },
  );
}
