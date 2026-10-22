/**
 * The cuts drawn over a `Scene3D` as DOM (the way the ducts annotations ride `onProject`): each
 * axis's cut on its frame's +w face, its node and edge grips, the offset line, and the curtain (the
 * cutting surface) while a grip is held or hot. Grips edit the page's `cuts`: the first valid move
 * of a drag pushes one history entry and the rest replace it, so Back undoes the whole drag. An
 * invalid draft is drawn red here and never reaches the page.
 */
import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { ListPopup } from "@pe/kit/lang/list-popup";
import { tokenRef } from "@pe/kit/lib/token";
import { frameRect, fromFrame, toFrame } from "#/scene/plane";
import type { Project, Ray, Size } from "#/scene/projection";
import type { Bounds } from "#/scene/types";

import {
  AXES,
  AXIS_LABEL,
  cutPolygon,
  cutPolygons,
  deleteNode,
  dragEdge,
  edgeCount,
  emptyCut,
  insertNode,
  moveNode,
  nearestOnSegment,
  offsetCut,
  type Axis,
  type Cut,
  type Cuts,
  type Point,
} from "./state";

export type Framed = { project: Project; size: Size; ray: Ray };
type Grip = { axis: Axis; kind: "node" | "edge"; index: number };
type Drag = Grip & {
  pointerId: number;
  start: Point;
  base: Cut;
  draft: Cut;
  /** Node drag: the neighbour it snapped onto; release merges into it. */
  merge: number | null;
  /** Edge drag: pushed past its neighbours' meeting point; release leaves one corner node. */
  collapsed: boolean;
  /** A valid draft has reached the page once (pushed); later ones replace it. */
  written: boolean;
};
type Menu = Grip & { point: Point; x: number; y: number };
type MenuAction = {
  key: string;
  label: string;
  refusal: string | null;
  run: () => Cut | null | string;
};

const PAD = 0.1;
const NODE_PX = 10;
const ROLE: Record<Axis, string> = { top: "viz-1", north: "viz-2", east: "viz-4" };

/** The pointer's point on an axis's editing plane, in frame (u, v); null for a grazing ray. */
function planePoint(axis: Axis, ray: Ray, bounds: Bounds, x: number, y: number): Point | null {
  const r = frameRect(axis, bounds);
  const { origin, direction } = ray(x, y);
  const o = toFrame(axis, origin),
    d = toFrame(axis, direction);
  if (Math.abs(d[2]) < 0.03) return null;
  const t = (r.w1 + PAD - o[2]) / d[2];
  const m = Math.max(r.u1 - r.u0, r.v1 - r.v0, 1);
  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo - m), hi + m);
  return [clamp(o[0] + t * d[0], r.u0, r.u1), clamp(o[1] + t * d[1], r.v0, r.v1)];
}

export function CutOverlay({
  framed,
  bounds,
  cuts,
  editing,
  onCuts,
  onError,
}: {
  framed: Framed;
  bounds: Bounds;
  cuts: Cuts;
  /** The axis shown large; null = the 3D picture, which offers every drawn cut's grips. */
  editing: Axis | null;
  onCuts: (next: Cuts, how: "push" | "replace") => void;
  onError: (message: string | null) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hot, setHot] = useState<Grip | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const { project, size, ray } = framed;
  const cutOf = (axis: Axis) => (drag?.axis === axis ? drag.draft : cuts[axis]);
  const axes = editing ? [editing] : AXES.filter((a) => edgeCount(cutOf(a)) > 0);
  const screen = (axis: Axis, p: Point) =>
    project(fromFrame(axis, p[0], p[1], frameRect(axis, bounds).w1 + PAD));
  const at = (e: { clientX: number; clientY: number }, el: Element) => {
    const box = el.closest("svg")!.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top] as const;
  };
  const valid = (axis: Axis, cut: Cut) => {
    try {
      cutPolygons({ ...cuts, [axis]: cut }, bounds);
      return true;
    } catch {
      return false;
    }
  };

  const down = (grip: Grip) => (e: ReactPointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    const start = planePoint(grip.axis, ray, bounds, ...at(e, e.currentTarget));
    if (!start) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const base = cuts[grip.axis];
    setDrag({
      ...grip,
      pointerId: e.pointerId,
      start,
      base,
      draft: base,
      merge: null,
      collapsed: false,
      written: false,
    });
  };
  const move = (e: ReactPointerEvent<SVGElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const [x, y] = at(e, e.currentTarget);
    const p = planePoint(drag.axis, ray, bounds, x, y);
    if (!p) return;
    let next: Drag;
    if (drag.kind === "edge") {
      const folded = dragEdge(drag.base, drag.index, [p[0] - drag.start[0], p[1] - drag.start[1]]);
      next = { ...drag, draft: folded.cut, collapsed: folded.collapsed };
    } else {
      // A node within reach of a neighbour snaps onto it; release merges the two.
      const { polyline, closed } = drag.base,
        n = polyline.length;
      const merge =
        [drag.index - 1, drag.index + 1]
          .filter((k) => closed || (k >= 0 && k < n))
          .map((k) => (k + n) % n)
          .find((k) => {
            const s = screen(drag.axis, polyline[k]!);
            return s !== null && Math.hypot(s[0] - x, s[1] - y) < NODE_PX;
          }) ?? null;
      const point = merge === null ? p : polyline[merge]!;
      next = { ...drag, merge, draft: moveNode(drag.base, drag.index, point) };
    }
    if (valid(next.axis, next.draft)) {
      onCuts({ ...cuts, [next.axis]: next.draft }, next.written ? "replace" : "push");
      next = { ...next, written: true };
    }
    setDrag(next);
  };
  const up = (e: ReactPointerEvent<SVGElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    setDrag(null);
    const result =
      drag.kind === "node" && drag.merge !== null ? deleteNode(drag.base, drag.index) : drag.draft;
    if (typeof result === "string") return onError(result);
    const cut = result ?? emptyCut;
    if (!valid(drag.axis, cut)) {
      // Snap back to the last valid draft the page holds.
      return onError(`${AXIS_LABEL[drag.axis]} cut: that shape crosses itself or cannot offset`);
    }
    onError(null);
    if (cut !== cuts[drag.axis])
      onCuts({ ...cuts, [drag.axis]: cut }, drag.written ? "replace" : "push");
  };
  const contextMenu = (grip: Grip) => (e: React.MouseEvent<SVGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const [x, y] = at(e, e.currentTarget);
    const cut = cutOf(grip.axis),
      n = cut.polyline.length;
    const on = planePoint(grip.axis, ray, bounds, x, y);
    const point =
      grip.kind === "node"
        ? cut.polyline[grip.index]!
        : on &&
          nearestOnSegment(on, cut.polyline[grip.index]!, cut.polyline[(grip.index + 1) % n]!);
    if (point) setMenu({ ...grip, point, x, y });
  };
  const gripProps = (grip: Grip) => ({
    onPointerDown: down(grip),
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: () => setDrag(null),
    onPointerEnter: () => setHot(grip),
    onPointerLeave: () => setHot(null),
    onContextMenu: contextMenu(grip),
    style: { pointerEvents: "auto" as const, cursor: "grab" },
  });
  const path = (pts: (readonly number[] | null)[], closed: boolean) => {
    const drawn = pts.filter((p): p is [number, number] => p !== null);
    return drawn.length < 2
      ? ""
      : drawn.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("") +
          (closed ? "Z" : "");
  };
  const curtainAxis = drag?.axis ?? hot?.axis ?? null;
  const curtain = (() => {
    const cut = curtainAxis && cutOf(curtainAxis);
    if (!curtainAxis || !cut || !edgeCount(cut)) return [];
    try {
      const r = frameRect(curtainAxis, bounds);
      const shifted = offsetCut(cut);
      const line = cut.closed
        ? [...shifted, shifted[0]!]
        : cutPolygon(cut, r).slice(0, shifted.length + 2);
      return line.slice(1).map((b, i) => {
        const a = line[i]!;
        return path(
          [
            project(fromFrame(curtainAxis, a[0], a[1], r.w0 - PAD)),
            project(fromFrame(curtainAxis, b[0], b[1], r.w0 - PAD)),
            project(fromFrame(curtainAxis, b[0], b[1], r.w1 + PAD)),
            project(fromFrame(curtainAxis, a[0], a[1], r.w1 + PAD)),
          ],
          true,
        );
      });
    } catch {
      return [];
    }
  })();
  const lit = (g: Grip) =>
    [drag, hot].some((h) => h && h.axis === g.axis && h.kind === g.kind && h.index === g.index);

  const menuCut = menu && cutOf(menu.axis);
  const actions: MenuAction[] = [];
  if (menu && menuCut && menu.kind === "edge")
    actions.push({
      key: "add",
      label: "Add node",
      refusal: null,
      run: () => insertNode(menuCut, menu.index, menu.point),
    });
  if (menu && menuCut && menu.kind === "node") {
    const result = deleteNode(menuCut, menu.index);
    actions.push({
      key: "delete",
      label: result === null ? "Delete node (clears the cut)" : "Delete node",
      refusal: typeof result === "string" ? result : null,
      run: () => result,
    });
  }

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0"
        width={size.width}
        height={size.height}
        data-space-cuts=""
      >
        {curtain.map((d, i) => (
          <path key={i} d={d} fill={tokenRef("viz-1")} fillOpacity={0.12} stroke="none" />
        ))}
        {axes.map((axis) => {
          const cut = cutOf(axis);
          const pts = cut.polyline.map((p) => screen(axis, p));
          const bad = drag?.axis === axis && !valid(axis, cut);
          const folding = drag?.axis === axis && (drag.collapsed || drag.merge !== null);
          let shifted: (readonly number[] | null)[] = [];
          try {
            if (cut.offset !== 0) shifted = offsetCut(cut).map((p) => screen(axis, p));
          } catch {
            shifted = [];
          }
          const n = cut.polyline.length;
          return (
            <g key={axis} data-cut-axis={axis}>
              <path
                d={path(pts, cut.closed)}
                fill="none"
                stroke={tokenRef(bad ? "alarm" : folding ? "caution" : ROLE[axis])}
                strokeWidth={editing === axis || drag?.axis === axis ? 2 : 1.25}
              />
              <path
                d={path(shifted, cut.closed)}
                fill="none"
                stroke={tokenRef("ink-2")}
                strokeDasharray="4 3"
              />
              {Array.from({ length: edgeCount(cut) }, (_, i) => {
                const a = pts[i],
                  b = pts[(i + 1) % n];
                if (!a || !b) return null;
                const grip: Grip = { axis, kind: "edge", index: i };
                return (
                  <g key={`e${i}`}>
                    <line
                      x1={a[0]}
                      y1={a[1]}
                      x2={b[0]}
                      y2={b[1]}
                      stroke="transparent"
                      strokeWidth={10}
                      style={{ pointerEvents: "stroke" }}
                      onContextMenu={contextMenu(grip)}
                    />
                    <circle
                      cx={(a[0] + b[0]) / 2}
                      cy={(a[1] + b[1]) / 2}
                      r={4}
                      fill={tokenRef(lit(grip) ? "caution" : "ink-mute")}
                      data-cut-grip="edge"
                      {...gripProps(grip)}
                    />
                  </g>
                );
              })}
              {pts.map((p, i) => {
                if (!p) return null;
                const grip: Grip = { axis, kind: "node", index: i };
                const merging = drag?.axis === axis && drag.merge === i;
                return (
                  <circle
                    key={`n${i}`}
                    cx={p[0]}
                    cy={p[1]}
                    r={5}
                    fill={tokenRef(merging ? "alarm" : lit(grip) ? "caution" : "ink")}
                    data-cut-grip="node"
                    {...gripProps(grip)}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      {menu && (
        <div
          ref={setAnchor}
          className="pointer-events-none absolute size-px"
          style={{ left: menu.x, top: menu.y }}
        />
      )}
      {menu && anchor && (
        <ListPopup<MenuAction>
          anchor="caret"
          purpose="menu"
          caret={anchor}
          open
          onOpenChange={(next) => !next && setMenu(null)}
          aria-label={`${AXIS_LABEL[menu.axis]} cut ${menu.kind} actions`}
          items={actions}
          keyOf={(item) => item.key}
          labelOf={(item) => item.label}
          filter="none"
          select="single"
          empty="no actions"
          row={(item) => ({ label: item.label, refusal: item.refusal })}
          onPick={(item) => {
            const result = item.run();
            setMenu(null);
            if (typeof result === "string") return onError(result);
            onCuts({ ...cuts, [menu.axis]: result ?? emptyCut }, "push");
          }}
        />
      )}
    </>
  );
}
