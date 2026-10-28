/**
 * The picture pane's two floaters: the orbit globe (`G`, the camera's minimap, drawing the subject's
 * centrelines in unit-sphere space) and the other picture small, where a click swaps the two.
 */
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@pe/kit/lang/button";
import type { FloaterSpec } from "@pe/kit/lang/floater";
import type { PicturePage } from "@pe/agent-contracts";
import { StageGlobe } from "#/scene/stage-globe";
import type { OrbitViewport } from "#/scene/orbit";
import type { LiveOrbit } from "@pe/kit/lang/live-orbit";
import { Scene3D } from "#/scene/scene3d";
import type { SceneMeshes } from "#/scene/types";
import type { PictureBounds } from "#/scene/framing";
import { idOf, type PictureLine } from "./model";

const CORNER = { width: 300, height: 176 } as const;

export function usePictureFloaters({
  picture,
  pose,
  bounds,
  lines: drawn,
  meshes,
  orbit,
  lit,
  selected,
  swap,
  small,
}: {
  picture: PicturePage["picture"];
  pose: OrbitViewport | null;
  bounds: PictureBounds | null;
  lines: readonly PictureLine[];
  meshes: SceneMeshes | null;
  orbit: LiveOrbit;
  lit: ReadonlySet<number>;
  selected: ReadonlySet<number>;
  swap: () => void;
  /** The other picture, small; absent = the picture has one mode and no corner. */
  small?: () => ReactNode;
}): FloaterSpec[] {
  const [globe, setGlobe] = useState(true);
  const [corner, setCorner] = useState(true);
  const segments = useMemo(() => drawn.filter((line) => line.points.length > 1), [drawn]);
  // The globe draws the subject's centrelines in unit-sphere space, scaled from its own radius.
  const lines = useMemo(() => {
    if (!bounds) return undefined;
    const b = bounds.subject;
    const c = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
    const k = 0.8 / Math.max(Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2, 1);
    return segments.map((line) => line.points.map((p) => p.map((v, j) => (v - c[j]!) * k)));
  }, [bounds, segments]);
  // The globe marks what the schematic marks: the hover-lit set heavy, the selection underlaid.
  const linesOf = (ids: ReadonlySet<number>) =>
    lines?.filter((_, index) => ids.has(idOf(segments[index]?.key ?? "e:")));
  const litLines = useMemo(() => linesOf(lit), [lines, segments, lit]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedLines = useMemo(() => linesOf(selected), [lines, segments, selected]); // eslint-disable-line react-hooks/exhaustive-deps
  return [
    {
      key: "globe",
      kind: "picture" as const,
      label: "globe",
      chord: "G",
      says: "Show or hide the globe: drag it to turn the camera, click a stop to look from there; it holds the projection and wiggle",
      place: "tr",
      open: globe && picture === "model",
      onOpenChange: setGlobe,
      render: () =>
        pose ? (
          <StageGlobe
            orbit={orbit}
            lines={lines}
            litLines={litLines}
            selectedLines={selectedLines}
          />
        ) : (
          <p className="t-small text-ink-2 m-0 p-2">no pose yet</p>
        ),
    },
    ...(small
      ? [
          {
            key: "corner",
            kind: "picture" as const,
            label: picture === "model" ? "schematic, small" : "model, small",
            says: "The other picture, small; a click swaps it with the main one",
            place: "br" as const,
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
                <span className="pointer-events-none flex size-full min-h-0 flex-col overflow-hidden">
                  {picture === "model" ? (
                    small()
                  ) : meshes && pose ? (
                    <Scene3D readout={null} className="size-full" meshes={meshes} orbit={orbit} />
                  ) : (
                    <span className="t-small text-ink-2 m-auto">model</span>
                  )}
                </span>
              </Button>
            ),
          },
        ]
      : []),
  ];
}
