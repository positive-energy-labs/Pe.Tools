/**
 * PROTOTYPE (round 2 · piece 3) — PARADIGM B · DRAWING-AS-FORM.
 *
 * THE CLAIM: the drawing IS the form. You do not find a solid by name in a tree, you point at the
 * box you already have in your head. Click a solid and its DIMENSIONS appear as clickable lines —
 * click one and you are editing the parameter that drives it, without ever having learned that the
 * parameter has a name. Every click re-renders the drawing, so the edit and its consequence are
 * one gesture.
 *
 * WHAT IT DRAWS AND WHAT IT DOES NOT. This is `/family`'s own v1 evaluator (`buildSheet`), which
 * centres every solid on the family centre planes and does NOT apply `frame`. That is a stated
 * approximation, not a silent one: fidelity is explicitly not this round's question, and the round
 * cannot afford a drawing that lies about a framed family without saying so. The banner says it on
 * the surface, because a caveat only in a file header is a caveat nobody reads.
 *
 * THE HONEST LIMIT ALREADY SHOWS: the showcase's four connectors sit on four frames, and every one
 * of those frames resolves through a solid FACE — so the connectors move when the body moves and
 * the solids themselves do not move when their frame changes. The drawing draws exactly that, and
 * paradigm B has no way to tell you the second half is the renderer's fault rather than the
 * document's. Paradigm A does.
 */
import { useMemo, useState } from "react";

import { fieldsOf } from "#/family-review/proto-editor/fields";
import { familyGraph, nodeValue } from "#/family-review/proto-editor/model";
import { RefToken, TextToken, type Editor } from "#/family-review/proto-editor/shell";
import {
  buildSheet,
  paramRef,
  resolveParam,
  sheetBounds,
  type Axis,
  type ConnGeo,
  type SolidGeo,
} from "#/family/family-model";

const SIZE = 320;
const PAD = 18;

interface View {
  name: string;
  right: Axis;
  up: Axis;
  depth: Axis;
}

const VIEWS: View[] = [
  { name: "plan · looking down", right: "x", up: "y", depth: "z" },
  { name: "front · looking at −Y", right: "x", up: "z", depth: "y" },
];

const AXIS_VECTOR: Record<string, [number, number, number]> = {
  "+X": [1, 0, 0],
  "-X": [-1, 0, 0],
  "+Y": [0, 1, 0],
  "-Y": [0, -1, 0],
  "+Z": [0, 0, 1],
  "-Z": [0, 0, -1],
};

const extent = (geo: SolidGeo, axis: Axis): [number, number] | null => {
  if (axis === "x") return geo.w == null ? null : [-geo.w / 2, geo.w / 2];
  if (axis === "y") return geo.d == null ? null : [-geo.d / 2, geo.d / 2];
  return geo.h == null ? null : [0, geo.h];
};

export function ParadigmB({ editor }: { editor: Editor }) {
  const [selected, setSelected] = useState<string | null>("solid:body");
  const sheet = useMemo(
    () => buildSheet(editor.model, editor.typeName),
    [editor.model, editor.typeName],
  );
  const bounds = useMemo(() => sheetBounds(sheet), [sheet]);
  const graph = useMemo(() => familyGraph(editor.model), [editor.model]);

  const span = Math.max(...(["x", "y", "z"] as Axis[]).map((a) => bounds[a][1] - bounds[a][0]));
  const scale = (SIZE - 2 * PAD) / span;
  const mid = (axis: Axis) => (bounds[axis][0] + bounds[axis][1]) / 2;
  const project = (view: View) => ({
    h: (value: number) => SIZE / 2 + (value - mid(view.right)) * scale,
    v: (value: number) => SIZE / 2 - (value - mid(view.up)) * scale,
  });

  const fields = selected ? fieldsOf(editor.model, selected) : [];
  const node = selected ? graph.byId.get(selected) : undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <p className="t-caption mb-2 max-w-[640px] text-[var(--pe-caution)]">
          This drawing is `/family`&apos;s v1 evaluator: every solid is centred on the family centre
          planes and sits on Bottom, and a solid&apos;s `frame` is NOT applied. Frames, planes and
          connectors resolve for real. Fidelity is not this round&apos;s question — pointing is.
        </p>
        <div className="flex flex-wrap gap-4">
          {VIEWS.map((view) => {
            const p = project(view);
            return (
              <figure key={view.name}>
                <svg
                  width={SIZE}
                  height={SIZE}
                  viewBox={`0 0 ${SIZE} ${SIZE}`}
                  style={{
                    background: "var(--pe-page)",
                    border: "0.5px solid var(--pe-line)",
                    borderRadius: 2,
                  }}
                  role="img"
                  aria-label={`${view.name} — click a part to edit what drives it`}
                >
                  {/* planes — the datums, drawn as their trace */}
                  {sheet.planes.map((plane) => {
                    if (plane.axis == null || plane.offset == null) return null;
                    if (plane.axis === view.depth) return null;
                    const vertical = plane.axis === view.right;
                    const at = vertical ? p.h(plane.offset) : p.v(plane.offset);
                    const id = `plane:${plane.slug}`;
                    return (
                      <Hit key={id} label={`plane ${plane.slug}`} onClick={() => setSelected(id)}>
                        <line
                          x1={vertical ? at : 0}
                          y1={vertical ? 0 : at}
                          x2={vertical ? at : SIZE}
                          y2={vertical ? SIZE : at}
                          stroke={selected === id ? "var(--pe-ink)" : "var(--pe-line-2)"}
                          strokeWidth={selected === id ? 1.4 : 0.75}
                        />
                        <text
                          x={vertical ? at + 3 : 4}
                          y={vertical ? 12 : at - 3}
                          className="face-mono"
                          fontSize={10}
                          fill="var(--pe-ink-mute)"
                        >
                          {plane.slug}
                        </text>
                      </Hit>
                    );
                  })}

                  {/* solids */}
                  {sheet.solids.map((geo) => {
                    const r = extent(geo, view.right);
                    const u = extent(geo, view.up);
                    if (!r || !u) return null;
                    const id = `solid:${geo.slug}`;
                    const on = selected === id;
                    const common = {
                      fill: geo.isVoid
                        ? "none"
                        : on
                          ? "var(--pe-select)"
                          : "color-mix(in srgb, var(--pe-ink) 10%, transparent)",
                      stroke: on ? "var(--pe-ink)" : "var(--pe-ink-2)",
                      strokeWidth: on ? 1.6 : 1,
                      strokeDasharray: geo.isVoid ? "4 3" : undefined,
                    };
                    return (
                      <Hit key={id} label={`solid ${geo.slug}`} onClick={() => setSelected(id)}>
                        {geo.isCyl && view.up === "y" && geo.w != null ? (
                          <circle cx={p.h(0)} cy={p.v(0)} r={(geo.w / 2) * scale} {...common} />
                        ) : (
                          <rect
                            x={Math.min(p.h(r[0]), p.h(r[1]))}
                            y={Math.min(p.v(u[0]), p.v(u[1]))}
                            width={Math.abs(p.h(r[1]) - p.h(r[0]))}
                            height={Math.abs(p.v(u[1]) - p.v(u[0]))}
                            {...common}
                          />
                        )}
                      </Hit>
                    );
                  })}

                  {/* the selected solid's dimensions — the point of the paradigm */}
                  {selected?.startsWith("solid:")
                    ? dimensionMarks(
                        editor,
                        sheet.solids,
                        selected.slice("solid:".length),
                        view,
                        p,
                      ).map((mark) => (
                        <Hit
                          key={mark.key}
                          label={`dimension ${mark.label}`}
                          onClick={() => setSelected(mark.id)}
                        >
                          <line
                            x1={mark.x1}
                            y1={mark.y1}
                            x2={mark.x2}
                            y2={mark.y2}
                            stroke="var(--pe-nav)"
                            strokeWidth={1}
                          />
                          <text
                            x={(mark.x1 + mark.x2) / 2}
                            y={(mark.y1 + mark.y2) / 2 - 3}
                            textAnchor="middle"
                            className="face-mono"
                            fontSize={10}
                            fill="var(--pe-nav)"
                          >
                            {mark.label}
                          </text>
                        </Hit>
                      ))
                    : null}

                  {/* frames — a small cross where every needed axis resolves */}
                  {sheet.frames.map((frame) => {
                    const rv = frame.pos[view.right];
                    const uv = frame.pos[view.up];
                    if (rv == null || uv == null) return null;
                    const id = `frame:${frame.slug}`;
                    const on = selected === id;
                    const cx = p.h(rv);
                    const cy = p.v(uv);
                    return (
                      <Hit key={id} label={`frame ${frame.slug}`} onClick={() => setSelected(id)}>
                        <line
                          x1={cx - 5}
                          y1={cy}
                          x2={cx + 5}
                          y2={cy}
                          stroke={on ? "var(--pe-ink)" : "var(--pe-ink-2)"}
                          strokeWidth={on ? 1.6 : 1}
                        />
                        <line
                          x1={cx}
                          y1={cy - 5}
                          x2={cx}
                          y2={cy + 5}
                          stroke={on ? "var(--pe-ink)" : "var(--pe-ink-2)"}
                          strokeWidth={on ? 1.6 : 1}
                        />
                      </Hit>
                    );
                  })}

                  {/* connectors, with their stub drawn along the frame normal */}
                  {sheet.conns.map((conn) => {
                    const rv = conn.pos[view.right];
                    const uv = conn.pos[view.up];
                    if (rv == null || uv == null) return null;
                    const id = `connector:${conn.slug}`;
                    const on = selected === id;
                    return (
                      <Hit
                        key={id}
                        label={`connector ${conn.slug}`}
                        onClick={() => setSelected(id)}
                      >
                        <ConnectorMark
                          conn={conn}
                          x={p.h(rv)}
                          y={p.v(uv)}
                          view={view}
                          scale={scale}
                          on={on}
                        />
                      </Hit>
                    );
                  })}
                </svg>
                <figcaption className="t-caption text-[var(--pe-ink-mute)]">{view.name}</figcaption>
              </figure>
            );
          })}
        </div>
      </div>

      {/* the one small editor for the thing that drives what you clicked */}
      <div
        className="min-h-0 w-80 shrink-0 overflow-auto border-l px-3 py-3"
        style={{ borderColor: "var(--pe-line)" }}
      >
        {node == null ? (
          <p className="t-caption text-[var(--pe-ink-mute)]">
            Click a solid, a plane, a frame or a connector in the drawing.
          </p>
        ) : (
          <>
            <div className="face-mono t-value text-[var(--pe-ink)]">{node.id}</div>
            <div className="t-caption mb-2 text-[var(--pe-ink-mute)]">{node.detail}</div>
            {fields.length === 0 ? (
              <p className="t-caption text-[var(--pe-ink-mute)]">
                stock datum — the template owns it, nothing here is authored
              </p>
            ) : (
              <table className="w-full">
                <tbody>
                  {fields.map((field) => (
                    <tr key={field.key}>
                      <td className="face-mono t-label w-24 py-0.5 align-baseline text-[var(--pe-ink-mute)]">
                        {field.key}
                      </td>
                      <td className="py-0.5 align-baseline">
                        {field.slot === "text" ? (
                          <TextToken
                            value={field.value}
                            title={`Write ${field.key} on ${node.id}`}
                            width={150}
                            onCommit={(text) => editor.apply((model) => field.write(model, text))}
                          />
                        ) : (
                          <RefToken
                            editor={editor}
                            value={field.value}
                            kind={field.slot}
                            title={`Point ${node.id}'s ${field.key} at another datum — the drawing redraws on pick`}
                            extra={field.value ? [field.value] : undefined}
                            onPick={(ref) => editor.apply((model) => field.write(model, ref))}
                          />
                        )}
                      </td>
                      <td className="face-mono t-caption py-0.5 pl-1 align-baseline text-[var(--pe-ink-mute)]">
                        {nodeValue(editor.model, editor.typeName, field.value) ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** A clickable drawing part. Keyboard-reachable, because the drawing is the only way in here. */
function Hit({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onClick();
      }}
      style={{ cursor: "pointer" }}
    >
      {children}
    </g>
  );
}

function ConnectorMark({
  conn,
  x,
  y,
  view,
  scale,
  on,
}: {
  conn: ConnGeo;
  x: number;
  y: number;
  view: View;
  scale: number;
  on: boolean;
}) {
  const stroke = on ? "var(--pe-ink)" : "var(--pe-ink-2)";
  const width = on ? 1.6 : 1;
  const axis = AXIS_VECTOR[conn.normal] ?? [0, 0, 1];
  const index: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
  const dh = axis[index[view.right]];
  const dv = -axis[index[view.up]];
  const stub = (conn.stub ?? 0) * scale;
  const half = ((conn.w ?? 4) / 2) * scale;
  return (
    <>
      <line
        x1={x}
        y1={y}
        x2={x + dh * stub}
        y2={y + dv * stub}
        stroke={stroke}
        strokeWidth={width}
      />
      <circle cx={x} cy={y} r={Math.max(2, half)} fill="none" stroke={stroke} strokeWidth={width} />
      <text x={x + 6} y={y - 4} className="face-mono" fontSize={10} fill="var(--pe-ink-mute)">
        {conn.slug}
      </text>
    </>
  );
}

interface Mark {
  key: string;
  /** The node the dimension DRIVES THROUGH — clicking it edits the parameter, not the solid. */
  id: string;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The selected solid's dimension lines, labelled with the parameter each one reads. */
function dimensionMarks(
  editor: Editor,
  solids: SolidGeo[],
  slug: string,
  view: View,
  p: { h: (value: number) => number; v: (value: number) => number },
): Mark[] {
  const solid = editor.model.solids?.[slug];
  const geo = solids.find((entry) => entry.slug === slug);
  if (!solid || !geo) return [];
  const axisRef: Partial<Record<Axis, string | undefined>> = {
    x: solid.width ?? solid.diameter,
    y: solid.depth ?? solid.diameter,
    z: solid.height,
  };
  const marks: Mark[] = [];
  const label = (ref: string | undefined) => {
    if (!ref) return null;
    const param = paramRef(ref);
    if (!param) return { id: ref, text: ref };
    return {
      id: ref,
      text: `${param} = ${resolveParam(editor.model, editor.typeName, param).text}`,
    };
  };

  const across = label(axisRef[view.right]);
  const rExtent = extent(geo, view.right);
  const uExtent = extent(geo, view.up);
  if (across && rExtent && uExtent) {
    const y = p.v(uExtent[0]) + 12;
    marks.push({
      key: `${slug}-${view.right}`,
      id: across.id,
      label: across.text,
      x1: p.h(rExtent[0]),
      y1: y,
      x2: p.h(rExtent[1]),
      y2: y,
    });
  }
  const along = label(axisRef[view.up]);
  if (along && rExtent && uExtent) {
    const x = p.h(rExtent[1]) + 10;
    marks.push({
      key: `${slug}-${view.up}`,
      id: along.id,
      label: along.text,
      x1: x,
      y1: p.v(uExtent[0]),
      x2: x,
      y2: p.v(uExtent[1]),
    });
  }
  return marks;
}
