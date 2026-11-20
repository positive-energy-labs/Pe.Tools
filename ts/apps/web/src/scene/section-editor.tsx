import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from "react";
import type { SceneSection, PlaneViewport } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { ButtonGroup } from "@pe/kit/lang/button-group";
import { StateCell, type CellHandle } from "@pe/kit/lang/cell";
import { PaneOverlay } from "@pe/kit/lang/pane";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { token } from "@pe/kit/lib/token";
import { AXIS_LABEL } from "@pe/web-kernel/scene/plane";
import { CUT_AXES, mergeCut, moveCutEdge, sectionCuts, type CutAxis, type Point } from "@pe/web-kernel/scene/cuts";
import type { Bounds } from "@pe/web-kernel/scene/types";
import type { SectionEditorController } from "./section-editor-controller";

/** Existing renderer supplies all three previews; the editor draws interaction geometry only. */
export function SectionEditor({
  controller,
  section,
  bounds,
  axis,
  viewport,
  onAxis,
  thumbnail,
}: {
  controller: SectionEditorController;
  section: SceneSection | null;
  bounds: Bounds;
  axis: CutAxis | null;
  viewport: PlaneViewport | null;
  onAxis: (axis: CutAxis | null) => void;
  thumbnail: (axis: CutAxis, canvas: HTMLCanvasElement | null) => void;
}) {
  const draft = useSyncExternalStore(controller.subscribe, controller.read);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    setRefusal(null);
  }, [section, axis]);
  const thumbnailRefs = useMemo(
    () =>
      Object.fromEntries(
        CUT_AXES.map((axis) => [
          axis,
          (canvas: HTMLCanvasElement | null) => thumbnail(axis, canvas),
        ]),
      ),
    [thumbnail],
  );
  const cuts = sectionCuts(draft?.section ?? section, bounds);
  const cut = cuts[axis ?? "top"];
  const drag = useRef<{
    id: number;
    start: Point;
    points: Point[];
    nodes: number[];
    draw: boolean;
  } | null>(null);
  const publish = (next: typeof cut) => {
    if (!axis) return;
    controller.begin({ kind: "cuts", cuts: { ...cuts, [axis]: next } });
    const reason = controller.release();
    setRefusal(reason);
    return reason ? { message: reason } : null;
  };
  const offset: CellHandle = {
    owner: { route: "picture", label: "Section offset" },
    value: { edit: null },
    refusal: null,
    transitions: () => [],
    stage: async (value) => {
      if (typeof value !== "number" || !Number.isFinite(value))
        return { message: "Enter finite feet" };
      return publish({ ...cut, offset: value }) ?? null;
    },
    clear: async () => {
      publish({ ...cut, offset: 0 });
      return null;
    },
  };
  const side: CellHandle = {
    ...offset,
    owner: { route: "picture", label: "Kept side" },
    stage: async (value) => {
      if (typeof value !== "boolean") return { message: "Choose a kept side" };
      return publish({ ...cut, keepInside: value }) ?? null;
    },
    clear: async () => {
      publish({ ...cut, keepInside: true });
      return null;
    },
  };
  const local = (e: PointerEvent<SVGSVGElement>): Point => {
    if (!viewport) throw new Error("An axis viewport is required to edit a cut");
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      (e.clientX - rect.left - viewport.tx) / viewport.scale,
      (viewport.ty - e.clientY + rect.top) / viewport.scale,
    ];
  };
  const screen = (p: Point): Point => {
    if (!viewport) throw new Error("An axis viewport is required to draw a cut");
    return [p[0] * viewport.scale + viewport.tx, viewport.ty - p[1] * viewport.scale];
  };
  const change = (points: Point[]) => {
    if (!axis) return;
    const next = {
      kind: "cuts" as const,
      cuts: { ...cuts, [axis]: { ...cut, polyline: points } },
    };
    controller.preview(next);
  };
  const end = (e: PointerEvent<SVGSVGElement>, cancel: boolean) => {
    if (drag.current?.id !== e.pointerId) return;
    if (!axis || !viewport) {
      drag.current = null;
      controller.cancel();
      return;
    }
    drag.current = null;
    if (cancel) controller.cancel();
    else {
      const own = controller.read()?.section;
      if (own?.kind === "cuts")
        controller.preview({
          ...own,
          cuts: { ...own.cuts, [axis]: mergeCut(own.cuts[axis], viewport.scale) },
        });
      setRefusal(controller.release());
    }
  };
  return (
    <>
      <PaneOverlay label="Bent section editor" place="bl">
        <ButtonGroup>
          {CUT_AXES.map((a) => (
            <span key={a} className="relative">
              <Button
                label={
                  axis === a
                    ? `Return to orbit from ${AXIS_LABEL[a]}`
                    : `Edit cut from ${AXIS_LABEL[a]}`
                }
                pressed={axis === a}
                onClick={() => {
                  controller.cancel();
                  onAxis(axis === a ? null : a);
                }}
              >
                <canvas ref={thumbnailRefs[a]} width={120} height={72} className="h-12 w-20" />
                {axis === a ? "Orbit" : AXIS_LABEL[a]}
              </Button>
            </span>
          ))}
        </ButtonGroup>
        {axis && (
          <>
            <ButtonGroup>
              <Button
                label="Return to orbit"
                onClick={() => {
                  controller.cancel();
                  onAxis(null);
                }}
              >
                Orbit · Esc
              </Button>
              <Button
                label={cut.closed ? "Reopen cut" : "Close cut"}
                refusal={cut.polyline.length < 3 ? "Draw three corners first" : null}
                onClick={() => publish({ ...cut, closed: !cut.closed })}
              >
                {cut.closed ? "Reopen" : "Close"}
              </Button>
              <Button
                label="Draw a new cut"
                onClick={() => publish({ ...cut, polyline: [], closed: false })}
              >
                New
              </Button>
            </ButtonGroup>
            <StateCell
              cell={offset}
              label="Cut offset in feet"
              model={cut.offset}
              parse={Number}
              format={String}
            />
            <StateCell
              cell={side}
              label="Kept side"
              model={cut.keepInside}
              current={String(cut.keepInside)}
              options={[
                { key: "true", label: cut.closed ? "Inside" : "Left", value: true },
                { key: "false", label: cut.closed ? "Outside" : "Right", value: false },
              ]}
            />
            <OutcomeLine
              kind="advisory"
              label={
                draft?.refusal ??
                refusal ??
                "Drag to draw; drag corners or edges. Right-click an edge to insert, a corner to delete. Bent cuts are uncapped."
              }
            />
          </>
        )}
      </PaneOverlay>
      {axis && viewport && (
        <svg
          tabIndex={0}
          aria-label={`${AXIS_LABEL[axis]} cut drawing`}
          className="absolute inset-0 size-full touch-none"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              drag.current = null;
              controller.cancel();
              onAxis(null);
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.focus();
            setRefusal(null);
            e.currentTarget.setPointerCapture(e.pointerId);
            const target =
                e.target instanceof Element ? e.target.closest("[data-node], [data-edge]") : null,
              node = target?.getAttribute("data-node") ?? null,
              edge = target?.getAttribute("data-edge") ?? null;
            const p = local(e),
              points = cut.polyline.map((p): Point => [...p]);
            const nodes =
              node !== null
                ? [Number(node)]
                : edge !== null
                  ? [Number(edge), (Number(edge) + 1) % points.length]
                  : [];
            drag.current = { id: e.pointerId, start: p, points, nodes, draw: !nodes.length };
            // Begin on contact so an external Page replacement invalidates the whole gesture.
            controller.begin({ kind: "cuts", cuts });
            if (!nodes.length) change([p]);
          }}
          onPointerMove={(e) => {
            const own = drag.current;
            if (!own || own.id !== e.pointerId) return;
            const p = local(e);
            if (own.draw) {
              const current = controller.read()?.section;
              const points = current?.kind === "cuts" ? current.cuts[axis].polyline : [];
              if (
                points.length < 56 &&
                (!points.length ||
                  Math.hypot(
                    p[0] - points[points.length - 1][0],
                    p[1] - points[points.length - 1][1],
                  ) *
                    viewport.scale >=
                    12)
              )
                change([...points, p]);
            } else if (own.nodes.length === 2)
              change(
                moveCutEdge({ ...cut, polyline: own.points }, own.nodes[0], [
                  p[0] - own.start[0],
                  p[1] - own.start[1],
                ]).polyline,
              );
            else
              change(
                own.points.map((at, i) =>
                  own.nodes.includes(i)
                    ? [at[0] + p[0] - own.start[0], at[1] + p[1] - own.start[1]]
                    : at,
                ),
              );
          }}
          onPointerUp={(e) => end(e, false)}
          onPointerCancel={(e) => end(e, true)}
          onLostPointerCapture={(e) => end(e, true)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const target =
              e.target instanceof Element ? e.target.closest("[data-node], [data-edge]") : null;
            const node = target?.getAttribute("data-node") ?? null,
              edge = target?.getAttribute("data-edge") ?? null;
            const points = cut.polyline.map((p): Point => [...p]);
            if (node !== null) points.splice(Number(node), 1);
            else if (edge !== null && points.length < 56) {
              const i = Number(edge),
                a = points[i],
                b = points[(i + 1) % points.length];
              points.splice(i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
            } else return;
            publish({ ...cut, polyline: points, closed: cut.closed && points.length >= 3 });
          }}
        >
          {cut.polyline.map((p, i) => {
            const a = screen(p),
              next = cut.polyline[(i + 1) % cut.polyline.length],
              b = screen(next);
            return (
              <g key={i}>
                {(i < cut.polyline.length - 1 || cut.closed) && (
                  <>
                    <line
                      data-edge={i}
                      x1={a[0]}
                      y1={a[1]}
                      x2={b[0]}
                      y2={b[1]}
                      stroke={token("ink-2")}
                    />
                    <line
                      data-edge={i}
                      x1={a[0]}
                      y1={a[1]}
                      x2={b[0]}
                      y2={b[1]}
                      stroke="transparent"
                      strokeWidth={10}
                    />
                  </>
                )}
                <foreignObject x={a[0] - 10} y={a[1] - 12} width={24} height={24}>
                  <Button
                    data-node={i}
                    label={`Cut corner ${i + 1}; arrow keys move by 0.25 feet`}
                    onKeyDown={(e) => {
                      if (e.altKey || e.ctrlKey || e.metaKey) return;
                      const moves: Record<string, Point> = {
                        ArrowLeft: [-0.25, 0],
                        ArrowRight: [0.25, 0],
                        ArrowUp: [0, 0.25],
                        ArrowDown: [0, -0.25],
                      };
                      const direction = moves[e.key];
                      if (!direction) return;
                      e.preventDefault();
                      e.stopPropagation();
                      publish({
                        ...cut,
                        polyline: cut.polyline.map((p, n) =>
                          n === i ? [p[0] + direction[0], p[1] + direction[1]] : p,
                        ),
                      });
                    }}
                  >
                    {i + 1}
                  </Button>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      )}
    </>
  );
}
