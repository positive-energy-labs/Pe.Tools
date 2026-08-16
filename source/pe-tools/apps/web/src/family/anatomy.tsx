/**
 * ANATOMY — the /family visual pane: true-scale front/side/plan of the authored family.
 *
 * WHAT IT IS: a drawing of the AUTHORED document, evaluated by the dumb evaluator in
 * `#/family/model`, flexed to one type, with the other types drawn behind it as ghost
 * outlines at the same scale. It is not a render and never claims to be one — a construct the
 * evaluator cannot place (a formula-driven plane with no evidence) is named in words rather
 * than drawn at a guessed position.
 *
 * SIZE: the triptych is fixed-size SVG, so `FitTriptych` measures the pane it lands in with a
 * ResizeObserver and hands the three views a shared edge length. There is no hardcoded size —
 * the pane is resizable and the drawing follows it.
 *
 * FOCUS: every hoverable mark reports through `onFocus` and every highlight is asked of
 * `#/family/focus`. This pane holds no highlight state of its own, which is what lets the
 * matrix, the geometry table, and the doc pane light up in step with it.
 *
 * EDITS: dimension chips and draggable plane lines write through `update`, which stages a
 * JSON Pointer patch in the route. Nothing here writes to a host.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { EditableValue } from "#/family/editable";
import { focusConstituentIds, focusHitsParam, type Focus } from "#/family/focus";
import {
  buildSheet,
  fmtIn,
  paramRef,
  planeGeos,
  resolveDim,
  resolveParam,
  setOverride,
  setParamValue,
  setSolidDim,
  sheetBounds,
  toggleRcp,
  toggleStub,
  usedByIndex,
  type Axis,
  type FamilyModel,
  type PlaneGeo,
  type SolidGeo,
  type Update,
} from "#/family/model";
import { Pane, PaneSplit } from "#/components/ui/pane";
import { fitFrame } from "#/lib/affine-frame";
import { cn } from "#/lib/utils";

interface ViewDef {
  key: string;
  label: string;
  u: Axis;
  v: Axis;
  depth: Axis;
}

const VIEWS: ViewDef[] = [
  { key: "front", label: "FRONT · looking −Y", u: "x", v: "z", depth: "y" },
  { key: "side", label: "SIDE · looking +X", u: "y", v: "z", depth: "x" },
  { key: "plan", label: "PLAN · looking −Z", u: "x", v: "y", depth: "z" },
];

/** The three connector domains Revit distinguishes, and nothing else wears these hues. */
export const DOMAIN_COLOR: Record<string, string> = {
  Duct: "var(--pe-blue)",
  Pipe: "var(--lichen)",
  Electrical: "var(--kiln)",
};

const NORMAL_RE = /^([+-])([XYZ])$/;

/** Card rail default — wide enough for a solid's four chips on one line. */
const CARD_RAIL_PX = 256;
const CARD_RAIL_MIN_PX = 34;

// ── the pane ────────────────────────────────────────────────────────────────────────────────────

export interface AnatomyPaneProps {
  model: FamilyModel;
  typeName: string;
  onType: (name: string) => void;
  update: Update;
  focus: Focus;
  /** Hover reporting — null clears. Hover NEVER opens, closes, or resizes anything. */
  onFocus: (focus: Focus) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function AnatomyPane({
  model,
  typeName,
  onType,
  update,
  focus,
  onFocus,
  collapsed,
  onCollapsedChange,
}: AnatomyPaneProps) {
  const typeNames = useMemo(() => Object.keys(model.types), [model.types]);
  const ghosts = typeNames.filter((name) => name !== typeName);

  return (
    <Pane
      kind="visual"
      toolbar={
        <>
          <span
            className="section-label"
            title="One type is always the one on stage: the drawings, the resolved dimensions, the card chips, and the matrix column all resolve as it. It selects a viewpoint and edits nothing."
          >
            resolving as
          </span>
          {typeNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onType(name)}
              title={`Resolve the drawing, every card chip, and every geometry cell as ${name}. The matrix column lights up to match — one type is always the one on stage.`}
              className={cn(
                "tele rounded-[var(--radius)] border px-2 py-0.5",
                name === typeName
                  ? "border-primary/40 bg-primary/[0.08]"
                  : "border-transparent text-muted-foreground hover:bg-muted",
              )}
            >
              {name}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--line-2)]" />
          <FamilyHeaderLine model={model} update={update} />
          <span className="ml-auto flex items-center gap-1.5">
            {ghosts.length > 0 && (
              <span
                className="tele text-muted-foreground"
                title="Every OTHER type is drawn behind this one as a thin outline at the same scale, so a type comparison needs no second drawing."
              >
                ghosts: {ghosts.join(" · ")}
              </span>
            )}
            <button
              type="button"
              onClick={() => onCollapsedChange(!collapsed)}
              title={
                collapsed
                  ? "Show the anatomy drawings again: true-scale front/side/plan of this family, resolved as the type on stage."
                  : "Collapse the anatomy and give the matrix the whole height — the right move when you are reconciling numbers against a spec rather than checking geometry. This bar stays, so it can always be brought back."
              }
              className="tele rounded-[var(--radius)] border border-[var(--line-2)] px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
            >
              {collapsed ? "▾ show anatomy" : "▴ hide anatomy"}
            </button>
          </span>
        </>
      }
    >
      <PaneSplit
        axis="horizontal"
        resize={{
          target: "end",
          defaultSize: CARD_RAIL_PX,
          minSize: CARD_RAIL_MIN_PX,
          maxSize: 420,
          minOtherSize: 240,
          persist: "pe.family.card-rail",
          collapse: { collapsedSize: CARD_RAIL_MIN_PX, collapseBelow: 120 },
        }}
        start={
          <div className="flex size-full min-h-0 flex-col">
            <FitTriptych>
              {(size) => (
                <Triptych
                  model={model}
                  typeName={typeName}
                  update={update}
                  focus={focus}
                  onFocus={onFocus}
                  size={size}
                />
              )}
            </FitTriptych>
            <Caption model={model} typeName={typeName} focus={focus} />
          </div>
        }
        end={
          <div className="size-full min-h-0 overflow-y-auto border-l border-[var(--line)] p-1.5">
            <RegisterCards
              model={model}
              typeName={typeName}
              update={update}
              focus={focus}
              onFocus={onFocus}
            />
            <AnatomyFooter model={model} typeName={typeName} update={update} onFocus={onFocus} />
          </div>
        }
      />
    </Pane>
  );
}

/** The triptych is fixed-size SVG; measure the box it lands in and hand it a view edge. */
function FitTriptych({ children }: { children: (size: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(96);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Three square views side by side: they share the width minus this box's p-2 padding
    // (16), two gap-3 gutters (24), and a few px of slack so a rounding error never wraps
    // the third view onto its own line. Height caps the square.
    const fit = Math.min((el.clientWidth - 16 - 24 - 6) / 3, el.clientHeight - 16);
    const next = Math.round(Math.max(88, Math.min(340, fit)));
    setSize((prev) => (prev === next ? prev : next));
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-auto p-2">
      {children(size)}
    </div>
  );
}

// ── the drawing ─────────────────────────────────────────────────────────────────────────────────

function Triptych({
  model,
  typeName,
  update,
  focus,
  onFocus,
  size,
}: {
  model: FamilyModel;
  typeName: string;
  update: Update;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  size: number;
}) {
  const sheet = useMemo(() => buildSheet(model, typeName), [model, typeName]);
  const box = useMemo(() => sheetBounds(sheet), [sheet]);
  const hits = useMemo(() => focusConstituentIds(focus, model), [focus, model]);
  const VIEW_W = size;
  const VIEW_H = size;
  const M = 14;
  const span = Math.max(...Object.values(box).map(([min, max]) => max - min));

  /** ONE hit test for the whole drawing. No focus ⇒ nothing lit and nothing dimmed. */
  const on = (id: string) => hits?.has(id) ?? false;
  const dimIf = (id: string) => (hits == null || hits.size === 0 || hits.has(id) ? 1 : 0.3);
  const enter = (id: string) => () => onFocus({ kind: "constituent", id });

  return (
    <div className="flex flex-wrap gap-3">
      {VIEWS.map((view) => {
        const [uMin, uMax] = box[view.u];
        const [vMin, vMax] = box[view.v];
        const uMid = (uMin + uMax) / 2;
        const vMid = (vMin + vMax) / 2;
        const frame = fitFrame(
          {
            minX: uMid - span / 2,
            minY: vMid - span / 2,
            maxX: uMid + span / 2,
            maxY: vMid + span / 2,
          },
          { width: VIEW_W, height: VIEW_H },
          { padding: M, yAxis: "up" },
        );
        const X = (u: number) => frame.toViewport([u, 0])[0];
        const Y = (v: number) => frame.toViewport([0, v])[1];

        const solidRect = (geo: SolidGeo) => {
          const du = view.u === "x" ? geo.w : view.u === "y" ? geo.d : null;
          const dv = view.v === "z" ? geo.h : view.v === "y" ? geo.d : null;
          if (du == null || dv == null) return null;
          const u0 = -du / 2;
          const v0 = view.v === "z" ? 0 : -dv / 2;
          return { x: X(u0), y: Y(v0 + dv), w: du * frame.scale, h: dv * frame.scale };
        };

        const dragPlane = (plane: PlaneGeo) => (event: React.PointerEvent<SVGGElement>) => {
          if (!plane.editable || !plane.param || !plane.axis) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const svg = event.currentTarget.ownerSVGElement;
          const along = plane.axis === view.u ? "u" : "v";
          const move = (pointer: PointerEvent) => {
            const inverse = svg?.getScreenCTM()?.inverse();
            if (!inverse) return;
            const point = new DOMPoint(pointer.clientX, pointer.clientY).matrixTransform(inverse);
            const content = frame.toContent([point.x, point.y]);
            const world = content[along === "u" ? 0 : 1];
            const value = Math.max(0.5, Math.abs(world));
            update((current) =>
              setOverride(current, typeName, plane.param as string, fmtIn(value)),
            );
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        };

        return (
          <svg
            key={view.key}
            width={VIEW_W}
            height={VIEW_H}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="rounded-[2px] border border-[var(--line)] bg-[var(--paper-2)]/30"
            onMouseLeave={() => onFocus(null)}
          >
            <title>{`${view.label} — true scale, flexed to type ${typeName}`}</title>
            <line
              x1={X(0)}
              y1={M}
              x2={X(0)}
              y2={VIEW_H - M}
              stroke="var(--line)"
              strokeDasharray="2 4"
            />
            <line
              x1={M}
              y1={Y(0)}
              x2={VIEW_W - M}
              y2={Y(0)}
              stroke="var(--line)"
              strokeDasharray="2 4"
            />

            {sheet.ghosts.map((ghost) =>
              ghost.solids
                .filter((geo) => !geo.isVoid)
                .map((geo) => {
                  const rect = solidRect(geo);
                  return rect ? (
                    <rect
                      key={`${ghost.typeName}:${geo.slug}`}
                      {...{ x: rect.x, y: rect.y, width: rect.w, height: rect.h }}
                      fill="none"
                      stroke="var(--slate)"
                      strokeWidth={0.75}
                      opacity={0.22}
                    />
                  ) : null;
                }),
            )}

            {sheet.solids.map((geo) => {
              const rect = solidRect(geo);
              if (!rect) return null;
              const id = `s:${geo.slug}`;
              const active = on(id);
              const shared = {
                fill: geo.isVoid ? "none" : "var(--clay-ink)",
                fillOpacity: geo.isVoid ? 0 : 0.07,
                stroke: active ? "var(--pe-blue)" : "var(--clay-ink)",
                strokeWidth: active ? 1.8 : 1,
                strokeDasharray: geo.isVoid ? "4 3" : undefined,
                opacity: dimIf(id),
                onMouseEnter: enter(id),
              };
              if (view.key === "plan" && geo.isCyl && geo.w != null)
                return (
                  <circle
                    key={geo.slug}
                    cx={X(0)}
                    cy={Y(0)}
                    r={(geo.w / 2) * frame.scale}
                    {...shared}
                  >
                    <title>{`${geo.slug} · ${geo.kind}`}</title>
                  </circle>
                );
              return (
                <rect
                  key={geo.slug}
                  {...{ x: rect.x, y: rect.y, width: rect.w, height: rect.h }}
                  {...shared}
                >
                  <title>{`${geo.slug} · ${geo.kind}`}</title>
                </rect>
              );
            })}

            {sheet.planes.map((plane) => {
              if (!plane.axis || plane.offset == null) return null;
              const id = `pl:${plane.slug}`;
              const overridden =
                plane.param != null && model.types[typeName]?.[plane.param] != null;
              const stroke = on(id)
                ? "var(--pe-blue)"
                : overridden
                  ? "var(--pe-blue)"
                  : "var(--lichen)";
              let line: { x1: number; y1: number; x2: number; y2: number } | null = null;
              if (plane.axis === view.u)
                line = { x1: X(plane.offset), y1: M, x2: X(plane.offset), y2: VIEW_H - M };
              else if (plane.axis === view.v)
                line = { x1: M, y1: Y(plane.offset), x2: VIEW_W - M, y2: Y(plane.offset) };
              if (!line) return null;
              return (
                <g
                  key={plane.slug}
                  opacity={dimIf(id)}
                  onMouseEnter={enter(id)}
                  onPointerDown={dragPlane(plane)}
                  style={{
                    cursor: plane.editable
                      ? plane.axis === view.u
                        ? "ew-resize"
                        : "ns-resize"
                      : undefined,
                  }}
                >
                  <title>
                    {plane.editable
                      ? `plane ${plane.slug} at ${plane.text} — drag to override it for type ${typeName}`
                      : `plane ${plane.slug} at ${plane.text} — formula-driven, so it is read-only here`}
                  </title>
                  <line {...line} stroke="transparent" strokeWidth={11} />
                  <line {...line} stroke={stroke} strokeWidth={on(id) ? 2 : 1.1} />
                  {view.key !== "plan" && plane.axis === "z" && (
                    <text x={line.x1 + 3} y={line.y1 - 3} fontSize={8} fill={stroke}>
                      {plane.slug} {plane.text}
                    </text>
                  )}
                  {plane.axis !== "z" && plane.axis === view.u && (
                    <text x={line.x1 + 3} y={M + 8} fontSize={8} fill={stroke}>
                      {plane.slug}
                    </text>
                  )}
                </g>
              );
            })}

            {sheet.conns.map((conn) => {
              const id = `c:${conn.slug}`;
              const color = on(id)
                ? "var(--pe-blue)"
                : (DOMAIN_COLOR[conn.domain] ?? "var(--slate)");
              const normal = NORMAL_RE.exec(conn.normal);
              if (!normal) return null;
              const [, signText, axisText] = normal;
              const axis = axisText.toLowerCase() as Axis;
              const sign = signText === "-" ? -1 : 1;
              const u = conn.pos[view.u];
              const v = conn.pos[view.v];
              if (u == null || v == null) return null;
              const shared = { opacity: dimIf(id), onMouseEnter: enter(id) };
              const label = <title>{`${conn.slug} · ${conn.domain}/${conn.shape}`}</title>;
              if (axis === view.depth) {
                if (conn.shape === "Round" && conn.w != null)
                  return (
                    <circle
                      key={conn.slug}
                      cx={X(u)}
                      cy={Y(v)}
                      r={(conn.w / 2) * frame.scale}
                      fill={color}
                      fillOpacity={0.14}
                      stroke={color}
                      strokeWidth={on(id) ? 2 : 1.2}
                      {...shared}
                    >
                      {label}
                    </circle>
                  );
                if (conn.w != null && conn.h != null)
                  return (
                    <rect
                      key={conn.slug}
                      x={X(u - conn.w / 2)}
                      y={Y(v + conn.h / 2)}
                      width={conn.w * frame.scale}
                      height={conn.h * frame.scale}
                      fill={color}
                      fillOpacity={0.14}
                      stroke={color}
                      strokeWidth={on(id) ? 2 : 1.2}
                      {...shared}
                    >
                      {label}
                    </rect>
                  );
                return null;
              }
              const stubLen = conn.stub ?? 3;
              const dir = sign * (conn.stubDir === "In" ? -1 : 1);
              const girth = conn.w ?? 2;
              const isU = axis === view.u;
              const tip = isU ? X(u + dir * stubLen) : Y(v + dir * stubLen);
              const base = isU ? X(u) : Y(v);
              return (
                <g key={conn.slug} {...shared}>
                  {label}
                  {isU ? (
                    <>
                      <line
                        x1={base}
                        y1={Y(v)}
                        x2={tip}
                        y2={Y(v)}
                        stroke={color}
                        strokeWidth={on(id) ? 2.4 : 1.6}
                      />
                      <line
                        x1={base}
                        y1={Y(v - girth / 2)}
                        x2={base}
                        y2={Y(v + girth / 2)}
                        stroke={color}
                        strokeWidth={on(id) ? 2.4 : 1.6}
                      />
                    </>
                  ) : (
                    <>
                      <line
                        x1={X(u)}
                        y1={base}
                        x2={X(u)}
                        y2={tip}
                        stroke={color}
                        strokeWidth={on(id) ? 2.4 : 1.6}
                      />
                      <line
                        x1={X(u - girth / 2)}
                        y1={base}
                        x2={X(u + girth / 2)}
                        y2={base}
                        stroke={color}
                        strokeWidth={on(id) ? 2.4 : 1.6}
                      />
                    </>
                  )}
                </g>
              );
            })}

            {sheet.rcp && sheet.rcp[view.u] != null && sheet.rcp[view.v] != null && (
              <g opacity={dimIf("rcp")} onMouseEnter={enter("rcp")}>
                <line
                  x1={X(0)}
                  y1={Y(0)}
                  x2={X(sheet.rcp[view.u] as number)}
                  y2={Y(sheet.rcp[view.v] as number)}
                  stroke="var(--kiln)"
                  strokeDasharray="1.5 3"
                />
                <circle
                  cx={X(sheet.rcp[view.u] as number)}
                  cy={Y(sheet.rcp[view.v] as number)}
                  r={3.5}
                  fill="var(--kiln)"
                />
              </g>
            )}

            <text x={M} y={VIEW_H - 4} fontSize={8} fill="var(--slate)" className="tele-label">
              {view.label}
            </text>
          </svg>
        );
      })}
    </div>
  );
}

// ── the caption: the authored reference chain of whatever is in focus ───────────────────────────

function Caption({
  model,
  typeName,
  focus,
}: {
  model: FamilyModel;
  typeName: string;
  focus: Focus;
}) {
  const usedBy = useMemo(() => usedByIndex(model), [model]);
  const line = useMemo(() => {
    if (!focus)
      return "hover anything — a shape, a card, a chip, a matrix cell, a geometry row — to read its authored reference chain";
    if (focus.kind === "param") {
      const spec = model.familyParameters[focus.name] ?? model.sharedParameters?.[focus.name];
      const resolved = resolveParam(model, typeName, focus.name);
      return `param ${focus.name} · ${spec?.dataType ?? "unknown type"}${
        spec?.formula ? ` · = ${spec.formula}` : ""
      } · ${typeName} resolves to ${resolved.text} (${resolved.source})`;
    }
    const id = focus.id;
    const cut = id.indexOf(":");
    const kind = id.slice(0, cut);
    const slug = id.slice(cut + 1);
    const users = usedBy[id]?.join(" · ");
    if (id === "rcp")
      return `roomCalculationPoint · authored surface is exactly { enabled: true } · rendered at the fixed PE convention (12in, ${model.family.placement === "Unhosted" ? "+Z" : "−Y"})`;
    if (kind === "s") {
      const solid = model.solids?.[slug];
      const dims = (["width", "depth", "height", "diameter"] as const)
        .filter((field) => solid?.[field])
        .map((field) => `${field} ${solid?.[field]}`)
        .join(" · ");
      return `solid ${slug} · ${solid?.kind} · ${dims}${users ? ` · faces used by ${users}` : ""}`;
    }
    if (kind === "pl") {
      const plane = model.planes?.[slug];
      const by = paramRef(plane?.by);
      return `plane ${slug} · from ${plane?.from} · by ${plane?.by}${
        by ? ` (${resolveParam(model, typeName, by).text})` : ""
      } · ${plane?.direction}${users ? ` · used by ${users}` : ""}`;
    }
    if (kind === "c") {
      const connector = model.connectors?.[slug];
      const frame = model.frames?.[connector?.frame.slice("frame:".length) ?? ""];
      const origin = frame ? frame.origin.join(" ∩ ") : connector?.frame;
      return `connector ${slug} · ${connector?.domain}/${connector?.shape} · origin = ${origin} · ${
        connector?.diameter
          ? `Ø ${connector.diameter}`
          : `${connector?.width} × ${connector?.height}`
      }${connector?.stub ? ` · stub ${connector.stub.direction} ${connector.stub.depth}` : ""}`;
    }
    return id;
  }, [focus, model, typeName, usedBy]);

  return (
    <p
      className="tele shrink-0 truncate border-t border-[var(--line-soft)] bg-[var(--paper-2)]/40 px-2 py-1.5 text-muted-foreground"
      title={line}
    >
      {line}
    </p>
  );
}

// ── the register cards ──────────────────────────────────────────────────────────────────────────

/** One authored dimension of one constituent. The chip is the smallest thing a focus can
 *  light — a card border says "this constituent", a lit chip says "this parameter". */
function DimChip({
  label,
  raw,
  model,
  typeName,
  update,
  focus,
  onFocus,
  parentId,
  onLiteral,
}: {
  label: string;
  raw: string | undefined;
  model: FamilyModel;
  typeName: string;
  update: Update;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  parentId: string;
  onLiteral?: (next: string) => void;
}) {
  const dim = resolveDim(model, typeName, raw);
  if (!dim) return null;
  const editable = dim.source !== "formula" && (dim.param != null || onLiteral != null);
  const lit = dim.param != null && focusHitsParam(focus, model, dim.param);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[2px] border bg-[var(--paper-2)]/50 px-1 py-0.5",
        lit ? "border-[var(--pe-blue)]" : "border-[var(--line)]",
      )}
      title={
        dim.param
          ? `${label} reads param:${dim.param}, which resolves to ${dim.text} for type ${typeName} (${dim.source}). Hovering lights that parameter everywhere; editing here stages it.`
          : `${label} is a portable literal authored on this constituent — no parameter drives it.`
      }
      onMouseEnter={() =>
        onFocus(
          dim.param ? { kind: "param", name: dim.param } : { kind: "constituent", id: parentId },
        )
      }
      onMouseLeave={() => onFocus({ kind: "constituent", id: parentId })}
    >
      <span className="tele-label text-[9px] text-[var(--slate)]">{label}</span>
      {editable ? (
        <EditableValue
          value={dim.text}
          onCommit={(next) =>
            dim.param
              ? update((current) =>
                  current.types[typeName]?.[dim.param as string] != null
                    ? setOverride(current, typeName, dim.param as string, next)
                    : setParamValue(current, dim.param as string, next),
                )
              : onLiteral?.(next)
          }
          className={cn("tele", dim.source === "override" && "text-[var(--pe-blue)]")}
        />
      ) : (
        <span className="tele text-[var(--kiln)]">{dim.text}</span>
      )}
    </span>
  );
}

function RegisterCard({
  id,
  title,
  tag,
  focus,
  onFocus,
  model,
  accent,
  children,
}: {
  id: string;
  title: string;
  tag: string;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  model: FamilyModel;
  accent?: string;
  children: React.ReactNode;
}) {
  const hits = focusConstituentIds(focus, model);
  const active = hits?.has(id) ?? false;
  const dim = hits != null && hits.size > 0 && !hits.has(id);
  return (
    <div
      className="rounded-[2px] border p-1.5 transition-opacity"
      style={{
        borderColor: active ? "var(--pe-blue)" : "var(--line)",
        boxShadow: accent ? `inset 3px 0 0 ${accent}` : undefined,
        opacity: dim ? 0.45 : 1,
      }}
      onMouseEnter={() => onFocus({ kind: "constituent", id })}
      onMouseLeave={() => onFocus(null)}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="tele font-semibold">{title}</span>
        <span className="tele-label text-[9px] text-[var(--slate)]">{tag}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function RegisterCards({
  model,
  typeName,
  update,
  focus,
  onFocus,
}: {
  model: FamilyModel;
  typeName: string;
  update: Update;
  focus: Focus;
  onFocus: (focus: Focus) => void;
}) {
  /** What a chip needs to resolve and stage a dimension; what a card needs to light up. */
  const chip = { model, typeName, update, focus, onFocus };
  const card = { model, focus, onFocus };
  const empty =
    Object.keys(model.solids ?? {}).length === 0 &&
    Object.keys(model.connectors ?? {}).length === 0 &&
    Object.keys(model.nestedFamilies ?? {}).length === 0 &&
    Object.keys(model.arrays ?? {}).length === 0;

  if (empty)
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        This document authors no solids, connectors, nested families, or arrays yet — add them to
        the JSON, or capture a real family in Revit to fill the drawing in.
      </p>
    );

  return (
    <div className="flex flex-col gap-1.5">
      {Object.entries(model.solids ?? {}).map(([slug, solid]) => (
        <RegisterCard key={slug} id={`s:${slug}`} title={slug} tag={solid.kind} {...card}>
          {(["width", "depth", "height", "diameter"] as const).map((field) => (
            <DimChip
              key={field}
              label={field === "diameter" ? "Ø" : field[0].toUpperCase()}
              raw={solid[field]}
              parentId={`s:${slug}`}
              onLiteral={(next) => update((current) => setSolidDim(current, slug, field, next))}
              {...chip}
            />
          ))}
        </RegisterCard>
      ))}
      {Object.entries(model.connectors ?? {}).map(([slug, connector]) => (
        <RegisterCard
          key={slug}
          id={`c:${slug}`}
          title={slug}
          tag={`${connector.domain} · ${connector.shape}`}
          accent={DOMAIN_COLOR[connector.domain] ?? "var(--slate)"}
          {...card}
        >
          <DimChip label="Ø" raw={connector.diameter} parentId={`c:${slug}`} {...chip} />
          <DimChip label="W" raw={connector.width} parentId={`c:${slug}`} {...chip} />
          <DimChip label="H" raw={connector.height} parentId={`c:${slug}`} {...chip} />
          {connector.stub && (
            <button
              type="button"
              onClick={() => update((current) => toggleStub(current, slug))}
              title={`The stub runs ${connector.stub.direction} of the connector face. Click to flip it — this stages an edit on the document, it does not move anything in Revit.`}
              className="tele rounded-[2px] border border-[var(--line)] px-1 py-0.5 hover:border-[var(--pe-blue)]"
            >
              stub {connector.stub.direction === "Out" ? "▸ Out" : "◂ In"}
            </button>
          )}
          {connector.systemType && (
            <span className="tele px-1 text-[var(--slate)]">{connector.systemType}</span>
          )}
        </RegisterCard>
      ))}
      {Object.entries(model.nestedFamilies ?? {}).map(([slug, spec]) => (
        <RegisterCard
          key={slug}
          id={`n:${slug}`}
          title={slug}
          tag={`nested · ${spec.family}`}
          {...card}
        >
          <div className="tele w-full space-y-0.5 text-[var(--slate)]">
            {spec.type && <div>type “{spec.type}”</div>}
            {Object.entries(spec.parameterBindings ?? {}).map(([target, source]) => (
              <div key={target}>
                {target} ← <span className="text-[var(--pe-blue)]">{source}</span>
              </div>
            ))}
          </div>
        </RegisterCard>
      ))}
      {Object.entries(model.arrays ?? {}).map(([slug, spec]) => (
        <RegisterCard
          key={slug}
          id={`a:${slug}`}
          title={`${slug} ×2n−1`}
          tag={`${spec.kind} · ${spec.axis}`}
          {...card}
        >
          <div className="tele w-full space-y-0.5 text-[var(--slate)]">
            <div>
              member <span className="text-[var(--pe-blue)]">{spec.member}</span>
            </div>
            <div>
              half-count <span className="text-[var(--kiln)]">{spec.halfCount}</span>
            </div>
            {spec.limits && (
              <div>
                limits {spec.limits.start} → {spec.limits.end}
              </div>
            )}
          </div>
        </RegisterCard>
      ))}
    </div>
  );
}

/** What the drawing cannot draw, said in words: formula-driven planes with no evidence, the
 *  room point's fixed convention, and whatever the schema could not replay. */
function AnatomyFooter({
  model,
  typeName,
  update,
  onFocus,
}: {
  model: FamilyModel;
  typeName: string;
  update: Update;
  onFocus: (focus: Focus) => void;
}) {
  const formulaPlanes = planeGeos(model, typeName).filter((plane) => plane.offset == null);
  const unmodeled = model.unmodeled ?? [];
  return (
    <div className="mt-2 space-y-1 border-t border-[var(--line-soft)] pt-2">
      {formulaPlanes.map((plane) => (
        <p key={plane.slug} className="tele text-[var(--kiln)]">
          ─ ─ plane {plane.slug} · {plane.text}{" "}
          <span className="text-[var(--slate)]">
            (formula-driven — capture or build evidence to draw it)
          </span>
        </p>
      ))}
      <button
        type="button"
        onClick={() => update(toggleRcp)}
        onMouseEnter={() => onFocus({ kind: "constituent", id: "rcp" })}
        onMouseLeave={() => onFocus(null)}
        className="tele rounded-[2px] border border-[var(--line)] px-1.5 py-0.5 hover:border-[var(--pe-blue)]"
        title='The entire authored surface is { "enabled": true } — direction and offset are the fixed PE convention, not something this document chooses. Clicking stages the flag.'
      >
        roomCalculationPoint ·{" "}
        <span
          className={
            model.roomCalculationPoint?.enabled ? "text-[var(--pe-blue)]" : "text-[var(--slate)]"
          }
        >
          {model.roomCalculationPoint?.enabled ? "enabled" : "off"}
        </span>
      </button>
      {unmodeled.length === 0 ? (
        <p
          className="tele text-[var(--lichen)]"
          title="Nothing was captured that the schema cannot replay, so a roundtrip through this document is claimable for this contract."
        >
          unmodeled ∅ — roundtrip equivalence claimable
        </p>
      ) : (
        <p
          className="tele text-cat-clay"
          title="Facts captured out of Revit that this schema has no home for. They will NOT survive a rebuild from this document — treat the drawing as incomplete until they are modeled."
        >
          unmodeled ×{unmodeled.length} — captured facts the schema cannot replay
        </p>
      )}
    </div>
  );
}

/** The family's own identity line: editable name, then the facts the template fixed. */
function FamilyHeaderLine({ model, update }: { model: FamilyModel; update: Update }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <EditableValue
        value={model.family.name}
        title="The family's name as this document authors it. Click to rename — the edit stages like any other and the document path does not follow it."
        onCommit={(next) =>
          update((current) => ({ ...current, family: { ...current.family, name: next } }))
        }
        className="text-sm font-semibold text-[var(--clay-ink)]"
      />
      <span
        className="tele-label truncate text-[9px] text-[var(--slate)]"
        title="Category, template, and placement come from the family template and are not editable here — changing them means a different template, which is a new family."
      >
        {model.family.category} · {model.family.template} · {model.family.placement}
      </span>
    </span>
  );
}
