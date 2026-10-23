import { useSceneReach } from "#/scene/reach";
/**
 * The picture pane's two floaters: the orbit globe (`G`, the camera's minimap, drawing the subject's
 * centrelines in unit-sphere space) and the other picture small, where a click swaps the two.
 */
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@pe/kit/lang/button";
import type { FloaterSpec } from "@pe/kit/lang/floater";
import { OrbitMinimap } from "#/components/lang/minimap";
import type { OrbitViewport } from "#/scene/orbit";
import type { LiveOrbit } from "#/scene/live-orbit";
import { Scene3D } from "#/scene/scene3d";
import type { SceneMeshes } from "#/scene/types";

import type { DuctsPage } from "../../manifest";
import type { PictureBounds } from "#/scene/framing";
import type { Scene } from "../../scene";

const CORNER = { width: 300, height: 176 } as const;

export function usePictureFloaters({
  picture,
  pose,
  bounds,
  scene,
  meshes,
  orbit,
  swap,
  small,
}: {
  picture: DuctsPage["picture"];
  pose: OrbitViewport | null;
  bounds: PictureBounds | null;
  scene: Scene;
  meshes: SceneMeshes | null;
  orbit: LiveOrbit;
  swap: () => void;
  /** The schematic, small. */
  small: () => ReactNode;
}): FloaterSpec[] {
  const { hovered } = useSceneReach();
  const lit = useMemo(
    () =>
      new Set(
        hovered == null
          ? []
          : (meshes?.instances
              .filter((instance) => instance.revitId === hovered)
              .map((instance) => instance.key) ?? []),
      ),
    [hovered, meshes],
  );
  const [globe, setGlobe] = useState(true);
  const [corner, setCorner] = useState(true);
  // The globe draws the subject's centrelines in unit-sphere space, scaled from its own radius.
  const lines = useMemo(() => {
    if (!bounds) return undefined;
    const b = bounds.subject;
    const c = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
    const k = 0.8 / Math.max(Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2, 1);
    return scene.segments.map((f) =>
      f.segment.polyline.map((p) => p.map((v, j) => (v - c[j]!) * k)),
    );
  }, [bounds, scene]);
  const litLines = useMemo(
    () => lines?.filter((_, index) => scene.segments[index]?.segment.id === hovered),
    [lines, scene, hovered],
  );
  return [
    {
      key: "globe",
      label: "globe",
      chord: "G",
      says: "Show or hide the globe: drag it to turn the camera, click a stop to look from there",
      place: "tr",
      open: globe && picture === "model",
      onOpenChange: setGlobe,
      render: () =>
        pose ? (
          <OrbitMinimap orbit={orbit} lines={lines} litLines={litLines} />
        ) : (
          <p className="t-small text-ink-2 m-0 p-2">no pose yet</p>
        ),
    },
    {
      key: "corner",
      label: picture === "model" ? "schematic, small" : "model, small",
      says: "The other picture, small; a click swaps it with the main one",
      place: "br",
      size: CORNER,
      open: corner,
      onOpenChange: setCorner,
      render: () => (
        <Button
          kind="quiet"
          label={`swap: the ${picture === "model" ? "schematic" : "model"} large`}
          data-picture-corner={picture === "model" ? "schematic" : "model"}
          onClick={swap}
        >
          {/* The floater's current size (`--floater-*`, set as the person resizes it) less its padding. */}
          <span className="pointer-events-none flex h-[calc(var(--floater-h)-8px)] w-[calc(var(--floater-w)-8px)] min-h-0 flex-col overflow-hidden">
            {picture === "model" ? (
              small()
            ) : meshes && pose ? (
              <Scene3D
                readout={null}
                className="size-full"
                meshes={meshes}
                orbit={orbit}
                lit={lit}
              />
            ) : (
              <span className="t-small text-ink-2 m-auto">model</span>
            )}
          </span>
        </Button>
      ),
    },
  ];
}
