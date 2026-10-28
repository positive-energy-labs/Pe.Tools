import { useMemo, useState } from "react";
import * as THREE from "three";
import { Button } from "@pe/kit/lang/button";
import { useLiveOrbit } from "@pe/kit/lang/live-orbit";
import { sceneRequest } from "#/scene/host";
import { useDuctScene } from "#/ducts/scene-read";
import { Scene3D } from "#/scene/scene3d";
import { frame, type OrbitViewport } from "#/scene/orbit";
import { instancePositions } from "#/scene/primitives";
import { markFrame, markLines } from "#/scene/marks";
import { inkOf } from "#/scene/ink";
import type { Layer3D, SceneMeshes } from "#/scene/types";
import type { OpenSheet } from "./use-sheet";

/** An edge layer over existing geometry. The scene owns its strokes and disposal. */
export function pathLayer(meshes: SceneMeshes, ids: ReadonlySet<number>): Layer3D {
  return {
    key: "sheet-worst-path",
    build(group) {
      const edges: [number[], number[]][] = [];
      for (const instance of meshes.instances) {
        if (instance.revitId == null || !ids.has(instance.revitId)) continue;
        const geometry = new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.BufferAttribute(instancePositions(meshes, instance), 3),
        );
        const outline = new THREE.EdgesGeometry(geometry, 30);
        const positions = outline.getAttribute("position");
        for (let i = 0; i < positions.count; i += 2)
          edges.push([
            [positions.getX(i), positions.getY(i), positions.getZ(i)],
            [positions.getX(i + 1), positions.getY(i + 1), positions.getZ(i + 1)],
          ]);
        outline.dispose();
        geometry.dispose();
      }
      group.add(markLines(edges, inkOf("ink"), { weight: 2 }));
    },
    frame: (group, at) => markFrame(group, { ...at, state: "focus" }),
  };
}

export function SheetPicture({
  sheet,
  select,
}: {
  sheet: OpenSheet;
  select: (id: number) => void;
}) {
  const request = useMemo(() => {
    if (!sheet.elements) return null;
    const ids = [
      ...new Set([
        ...sheet.elements.walkedElementIds,
        ...sheet.worstLegs.flatMap((path) => path.legs.map((leg) => leg.elementId)),
      ]),
    ];
    return ids.length ? sceneRequest(ids, true) : null;
  }, [sheet.elements, sheet.worstLegs]);
  const capture = useDuctScene(request, sheet.overview.target, sheet.overview.basis);
  const meshes = capture.meshes;
  const worstIds = useMemo(
    () => new Set(sheet.worstLegs.flatMap((path) => path.legs.map((leg) => leg.elementId))),
    [sheet.worstLegs],
  );
  const layers = useMemo(
    () => (meshes && worstIds.size ? [pathLayer(meshes, worstIds)] : []),
    [meshes, worstIds],
  );
  const [viewport, setViewport] = useState<OrbitViewport | null>(null);
  const pose = viewport ?? (meshes ? frame(meshes.bounds) : null);
  const orbit = useLiveOrbit(pose, setViewport, sheet.overview.basis, viewport);
  return (
    <section className="space-y-2" aria-label="Worst path in 3D">
      <div className="flex items-center justify-between gap-3">
        <h3 className="t-head">
          3D · {worstIds.size ? "worst complete paths" : "walked elements · no complete worst path"}
        </h3>
        <Button
          label="Fit sheet elements"
          refusal={meshes ? null : "No scene yet"}
          onClick={() => {
            if (meshes) setViewport(frame(meshes.bounds));
          }}
        >
          fit
        </Button>
      </div>
      {capture.pending && <p role="status">Reading focus geometry…</p>}
      {capture.error && (
        <p role="alert" data-tone="alarm">
          {capture.error}
        </p>
      )}
      {(capture.omittedElements > 0 || capture.unavailableElements > 0) && (
        <p data-tone="caution">
          Geometry omitted: {capture.omittedElements} · unavailable: {capture.unavailableElements}
        </p>
      )}
      <div className="h-80 min-h-0">
        <Scene3D
          readout={null}
          meshes={meshes}
          orbit={orbit}
          layers={layers}
          colour="mono"
          contextMode="off"
          onPick={(pick) => {
            if (pick?.instance.revitId) select(pick.instance.revitId);
          }}
          className="size-full"
        />
      </div>
    </section>
  );
}
