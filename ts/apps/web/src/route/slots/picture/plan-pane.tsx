import type { PlanPicture, XY } from "@pe/agent-contracts/slots";
import { useMention } from "@pe/kit/lang/attention";
import { tokenRef } from "@pe/kit/lib/token";
import { runtimeStreamUrl } from "@pe/web-kernel/host/runtime";
import { boundsOf } from "@pe/web-kernel/lib/affine-frame";
import { PLAN_CLICK_PX, usePlaneViewport } from "@pe/web-kernel/scene/use-plane-viewport";
import { PlanImageLayer, planCorners } from "#/scene/plan-image";
import { subjectName } from "../subject-name.ts";
import type { PicturePaneContext } from "./pane.tsx";

const pathOf = (rings: readonly (readonly XY[])[]) =>
  rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => `M${ring.map(([x, y]) => `${x},${y}`).join("L")}Z`)
    .join("");

export function PlanPane({
  plan,
  draw,
  name,
}: {
  plan: PlanPicture;
  draw: PicturePaneContext["draw"];
  name: string;
}) {
  const mention = useMention();
  const { raster, polygons } = plan;
  const points = polygons.flatMap(({ rings }) => rings.flat());
  if (raster) points.push(...planCorners(raster));
  // The plane viewport fits and pans in y-down content. The SVG group flips model Y once.
  const fit = points.length ? boundsOf(points.map(([x, y]): XY => [x, -y])) : null;
  const { viewport: pose } = draw.page.read();
  const { view, setHost, handlers, readout, dragging, dragDistance } = usePlaneViewport(
    pose?.kind === "plane" ? pose : null,
    fit,
    (viewport, how) => draw.page.pose({ viewport }, how === "gesture" ? "gesture" : "named"),
    null,
  );
  const { scale, tx, ty } = view;
  const selected = new Set(draw.selection.read().map(({ id }) => id));
  return (
    <div
      ref={setHost}
      data-picture="plan"
      className="relative size-full min-h-0 overflow-hidden"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      {...handlers}
      onDoubleClick={() => draw.page.pose({ viewport: null }, "named")}
    >
      {fit ? (
        <svg width="100%" height="100%" role="group" aria-label={name}>
          {raster && (
            <PlanImageLayer
              plan={
                raster.href.startsWith("/captures/")
                  ? { ...raster, href: runtimeStreamUrl(raster.href) }
                  : raster
              }
              frame={{ scale, toViewport: ([x, y]) => [tx + scale * x, ty - scale * y] }}
            />
          )}
          <g transform={`matrix(${scale},0,0,${-scale},${tx},${ty})`}>
            {polygons.map(({ subject, rings, ink = "viz-3" }, index) => {
              const d = pathOf(rings);
              if (!d) return null;
              const colour = /^#[0-9a-f]{6}$/i.test(ink) ? ink : tokenRef(ink);
              const pick = () => draw.selection.set([{ kind: "focus", id: subject }]);
              return (
                <path
                  key={`${subject}:${index}`}
                  {...mention(subject)}
                  role="button"
                  aria-label={subjectName(subject)}
                  tabIndex={0}
                  data-selected={selected.has(subject) || undefined}
                  d={d}
                  fillRule="evenodd"
                  fill={`color-mix(in srgb, ${colour} 15%, transparent)`}
                  stroke={colour}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="visibleFill"
                  onClick={() => {
                    if (dragDistance.current < PLAN_CLICK_PX) pick();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    pick();
                  }}
                />
              );
            })}
          </g>
        </svg>
      ) : (
        <p role="status">No plan geometry</p>
      )}
      {readout}
    </div>
  );
}
