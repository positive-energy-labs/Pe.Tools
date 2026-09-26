/**
 * The one /ducts drawing: a projection of model feet onto a pannable, zoomable SVG. The plan and
 * the isometric differ only in `project` (and what they hand it); everything drawn here goes
 * through the encoding substrate (`encoding.tsx`). The subject group is drawn at full weight, one
 * path per segment; the rest of the document is faint context, one path per level. Line widths
 * are screen px at every zoom (non-scaling stroke); glyphs and issue markers sit in screen space.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { boundsOf, type Bounds2, type Point2, type Viewport2 } from "#/lib/affine-frame";
import { token } from "#/lib/token";
import {
  DASH_CLASS,
  issueInk,
  nodeInk,
  strokeOf,
  type DuctNode,
  type Encoding,
  type EncodingFacts,
  type Issue,
  type Segment,
  type SegmentFacts,
} from "./encoding";

/** Model feet [x, y, z] to drawing feet [x, y-down]. */
export type Project = (point: readonly number[]) => Point2;

export interface NodeFacts extends EncodingFacts {
  node: DuctNode;
  issues: readonly Issue[];
}

export interface Scene {
  segments: readonly SegmentFacts[];
  nodes: readonly NodeFacts[];
  /** Issues with a point; each is one marker. */
  issues: readonly Issue[];
  /** Faint context, one entry per level: the other groups' segments there. */
  context: readonly (readonly Pick<Segment, "polyline">[])[];
}

type View = { scale: number; tx: number; ty: number };
const ZOOM = [0.05, 400] as const;
const CLICK_PX = 5;
const FIT_PAD_PX = 32;
/** A segment whose drawing shrinks under this many feet while its length is real is a riser. */
const RISER_FT = 0.25;
const GLYPH = 4;
const MARK = 5;

const d = (segments: readonly Pick<Segment, "polyline">[], project: Project) => {
  let out = "";
  for (const segment of segments) {
    segment.polyline.forEach((point, i) => {
      const [x, y] = project(point);
      out += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
  }
  return out;
};

const span = (segment: Segment, project: Project) => {
  const a = project(segment.polyline[0]!);
  const b = project(segment.polyline.at(-1)!);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
};

const fitView = (box: Bounds2, size: Viewport2): View => {
  const w = Math.max(box.maxX - box.minX, 1);
  const h = Math.max(box.maxY - box.minY, 1);
  const scale = Math.min(
    ZOOM[1],
    Math.max(
      ZOOM[0],
      Math.min((size.width - 2 * FIT_PAD_PX) / w, (size.height - 2 * FIT_PAD_PX) / h),
    ),
  );
  return {
    scale,
    tx: (size.width - w * scale) / 2 - box.minX * scale,
    ty: (size.height - h * scale) / 2 - box.minY * scale,
  };
};

/** Each node kind's glyph, centred on 0,0 in screen px. */
function Glyph({ kind, ink }: { kind: DuctNode["kind"]; ink: string }) {
  const g = GLYPH;
  switch (kind) {
    case "equipment":
      return <rect x={-g * 1.5} y={-g * 1.5} width={g * 3} height={g * 3} fill={ink} />;
    case "terminal":
      return <path d={`M0 ${-g * 1.4}L${g * 1.3} ${g}L${-g * 1.3} ${g}Z`} fill={ink} />;
    case "cap":
      return (
        <path d={`M${-g} ${-g}L${g} ${g}M${g} ${-g}L${-g} ${g}`} stroke={ink} strokeWidth={2} />
      );
    case "accessory":
      return (
        <path d={`M0 ${-g}L${g} 0L0 ${g}L${-g} 0Z`} fill="none" stroke={ink} strokeWidth={1.5} />
      );
    default:
      return <circle r={g * 0.5} fill={ink} />;
  }
}

const NODE_GLYPHS: readonly { kind: DuctNode["kind"]; word: string }[] = [
  { kind: "equipment", word: "equipment" },
  { kind: "terminal", word: "terminal" },
  { kind: "accessory", word: "accessory" },
  { kind: "fitting", word: "fitting" },
  { kind: "cap", word: "cap" },
];

export function GlyphKey() {
  return (
    <span className="flex items-center gap-2">
      {NODE_GLYPHS.map(({ kind, word }) => (
        <span key={kind} className="flex items-center gap-1">
          <svg aria-hidden width="12" height="12" viewBox="-6 -6 12 12">
            <Glyph kind={kind} ink={token("ink-2")} />
          </svg>
          {word}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <svg aria-hidden width="12" height="12" viewBox="-6 -6 12 12">
          <circle r={4} fill="none" stroke={token("ink-2")} strokeWidth={1.5} />
          <path d="M-3 3L3 -3" stroke={token("ink-2")} strokeWidth={1.5} />
        </svg>
        riser
      </span>
    </span>
  );
}

export function DuctDrawing({
  label,
  project,
  scene,
  encoding,
  fitKey,
  selected,
  critical,
  hovered,
  issue,
  onHover,
  onSelect,
  onSelectIssue,
  onDrag,
  underlay,
}: {
  label: string;
  project: Project;
  scene: Scene;
  encoding: Encoding;
  /** The view refits when this changes (a new group, level or yaw step), never on a refresh. */
  fitKey: string;
  selected: ReadonlySet<number>;
  critical?: ReadonlySet<number>;
  hovered: number | null;
  issue: string;
  onHover: (id: number | null) => void;
  onSelect: (id: number | null) => void;
  onSelectIssue: (issue: Issue) => void;
  /** A drag the view consumes (the isometric rotates); returning false pans. */
  onDrag?: (dx: number, dy: number, shift: boolean) => boolean;
  /** Drawn first, in drawing feet, given the visible bounds. */
  underlay?: (box: Bounds2) => ReactNode;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Viewport2 | null>(null);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; rotating: boolean } | null>(
    null,
  );
  const dragDist = useRef(0);

  useEffect(() => {
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize(width > 0 && height > 0 ? { width, height } : null);
    });
    observer.observe(host);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      setView((v) => {
        const scale = Math.min(
          ZOOM[1],
          Math.max(ZOOM[0], v.scale * Math.exp(-event.deltaY * 0.0015)),
        );
        return {
          scale,
          tx: cx - ((cx - v.tx) * scale) / v.scale,
          ty: cy - ((cy - v.ty) * scale) / v.scale,
        };
      });
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      host.removeEventListener("wheel", onWheel);
    };
  }, [host]);

  // Projected once per projection: the heavy strings never rebuild on pan or zoom.
  const drawn = useMemo(() => {
    const segments = scene.segments.map((facts) => {
      const riser = span(facts.segment, project) < RISER_FT && facts.segment.lengthFt > 0.5;
      return {
        facts,
        stroke: strokeOf(encoding, facts),
        d: d([facts.segment], project),
        riser: riser ? project(facts.segment.polyline[0]!) : null,
      };
    });
    const context = scene.context.map((level) => d(level, project));
    const nodes = scene.nodes.map((facts) => ({
      facts,
      at: project(facts.node.point),
      stroke: encoding.nodes
        ? strokeOf(encoding, facts)
        : { ink: nodeInk(encoding, facts.issues), dash: null },
    }));
    const issues = scene.issues.map((item) => ({ issue: item, at: project(item.point!) }));
    const points = [
      ...scene.segments.flatMap((f) => f.segment.polyline.map(project)),
      ...nodes.map((n) => n.at),
    ];
    const contextPoints = points.length
      ? points
      : scene.context.flat().flatMap((s) => s.polyline.map(project));
    return {
      segments,
      context,
      nodes,
      issues,
      box: contextPoints.length ? boundsOf(contextPoints) : null,
    };
  }, [scene, project, encoding]);

  const fitted = useRef("");
  useEffect(() => {
    if (!size || !drawn.box) return;
    const key = `${fitKey}|${size.width}|${size.height}`;
    if (fitted.current === key) return;
    fitted.current = key;
    setView(fitView(drawn.box, size));
  }, [size, drawn.box, fitKey]);

  const screen = ([x, y]: Point2): Point2 => [x * view.scale + view.tx, y * view.scale + view.ty];
  const visible: Bounds2 | null = size
    ? {
        minX: -view.tx / view.scale,
        minY: -view.ty / view.scale,
        maxX: (size.width - view.tx) / view.scale,
        maxY: (size.height - view.ty) / view.scale,
      }
    : null;
  const click = (run: () => void) => (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    if (dragDist.current < CLICK_PX) run();
  };
  const halo = (id: number) =>
    selected.has(id) ? token("select") : id === hovered ? token("veil") : null;

  return (
    <div
      ref={setHost}
      data-ducts-drawing={label}
      className="relative min-h-0 flex-1 overflow-hidden"
      style={{ cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          tx: view.tx,
          ty: view.ty,
          rotating: false,
        };
        dragDist.current = 0;
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        dragDist.current = Math.max(dragDist.current, Math.abs(dx) + Math.abs(dy));
        if (dragDist.current < CLICK_PX) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        if (onDrag?.(event.movementX, event.movementY, event.shiftKey)) return;
        setView((v) => ({ ...v, tx: start.tx + dx, ty: start.ty + dy }));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onClick={() => {
        if (dragDist.current < CLICK_PX) onSelect(null);
      }}
    >
      {size ? (
        <svg
          width={size.width}
          height={size.height}
          role="img"
          aria-label={label}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          <g transform={`matrix(${view.scale} 0 0 ${view.scale} ${view.tx} ${view.ty})`}>
            {underlay && visible ? underlay(visible) : null}
            {drawn.context.map((path, i) =>
              path ? (
                <path
                  key={i}
                  data-context=""
                  d={path}
                  fill="none"
                  stroke={token("ink-mute")}
                  strokeOpacity={0.35}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              ) : null,
            )}
            {drawn.segments.map(({ facts, stroke, d: path }) => {
              const id = facts.segment.id;
              const back = halo(id);
              return (
                <g
                  key={id}
                  data-segment={id}
                  data-critical={critical?.has(id) ? "" : undefined}
                  data-selected={selected.has(id) ? "" : undefined}
                >
                  {critical?.has(id) ? (
                    <path
                      d={path}
                      fill="none"
                      stroke={token("ink")}
                      strokeWidth={stroke.width + 4}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                  {back ? (
                    <path
                      d={path}
                      fill="none"
                      stroke={back}
                      strokeWidth={stroke.width + 8}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                  <path
                    d={path}
                    fill="none"
                    stroke={stroke.ink}
                    strokeWidth={stroke.width}
                    strokeLinecap="round"
                    className={stroke.dash ? DASH_CLASS[stroke.dash] : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => onHover(id)}
                    onMouseLeave={() => onHover(null)}
                    onClick={click(() => onSelect(id))}
                  />
                </g>
              );
            })}
          </g>
          {drawn.segments.map(({ facts, stroke, riser }) => {
            if (!riser) return null;
            const [x, y] = screen(riser);
            const id = facts.segment.id;
            const back = halo(id);
            return (
              <g
                key={`r${id}`}
                data-riser={id}
                data-selected={selected.has(id) ? "" : undefined}
                transform={`translate(${x} ${y})`}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => onHover(id)}
                onMouseLeave={() => onHover(null)}
                onClick={click(() => onSelect(id))}
              >
                {back ? <circle r={9} fill={back} /> : null}
                <circle r={5} fill={token("page")} stroke={stroke.ink} strokeWidth={stroke.width} />
                <path d="M-3.5 3.5L3.5 -3.5" stroke={stroke.ink} strokeWidth={1.5} />
              </g>
            );
          })}
          {drawn.nodes.map(({ facts, at, stroke }) => {
            const [x, y] = screen(at);
            const id = facts.node.id;
            const back = halo(id);
            return (
              <g
                key={id}
                data-node={facts.node.kind}
                data-node-id={id}
                data-critical={critical?.has(id) ? "" : undefined}
                data-selected={selected.has(id) ? "" : undefined}
                transform={`translate(${x} ${y})`}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => onHover(id)}
                onMouseLeave={() => onHover(null)}
                onClick={click(() => onSelect(id))}
              >
                {back ? <circle r={GLYPH * 2.5} fill={back} /> : null}
                {critical?.has(id) || stroke.dash ? (
                  <circle
                    r={GLYPH * 1.7}
                    fill="none"
                    stroke={stroke.dash ? stroke.ink : token("ink")}
                    className={stroke.dash ? DASH_CLASS[stroke.dash] : undefined}
                  />
                ) : null}
                <Glyph kind={facts.node.kind} ink={stroke.ink} />
              </g>
            );
          })}
          {drawn.issues.map(({ issue: item, at }) => {
            const [x, y] = screen(at);
            const ink = issueInk(item);
            const on = item.id === issue;
            return (
              <g
                key={item.id}
                data-issue={item.kind}
                transform={`translate(${x} ${y - MARK * 2.2})`}
                style={{ cursor: "pointer" }}
                onClick={click(() => onSelectIssue(item))}
              >
                <title>{item.note}</title>
                <path
                  d={`M0 ${MARK * 2.2}L${-MARK} 0A${MARK} ${MARK} 0 1 1 ${MARK} 0Z`}
                  fill={ink}
                  stroke={on ? token("ink") : token("page")}
                  strokeWidth={on ? 2.5 : 1}
                />
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
