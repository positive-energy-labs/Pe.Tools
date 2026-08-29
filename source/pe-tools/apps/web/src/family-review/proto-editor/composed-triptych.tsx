/**
 * The composed editor's three-view drawing. It is a view; selection opens the owning inputs.
 */
import { useMemo } from "react";

import type { Editor } from "#/family-review/proto-editor/shell";
import {
  buildSheet,
  sheetBounds,
  type Axis,
  type ConnGeo,
  type SolidGeo,
} from "#/family/family-model";
import { token } from "#/lib/token";

// ── the triptych ────────────────────────────────────────────────────────────────────────────────

const SIZE = 190;
const PAD = 12;

interface View {
  name: string;
  right: Axis;
  up: Axis;
  depth: Axis;
}

const VIEWS: View[] = [
  { name: "plan", right: "x", up: "y", depth: "z" },
  { name: "front", right: "x", up: "z", depth: "y" },
  { name: "right", right: "y", up: "z", depth: "x" },
];

const AXIS_VECTOR: Record<string, readonly [number, number, number]> = {
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

export function Triptych({
  editor,
  selected,
  onSelect,
}: {
  editor: Editor;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const sheet = useMemo(
    () => buildSheet(editor.model, editor.typeName),
    [editor.model, editor.typeName],
  );
  const bounds = useMemo(() => sheetBounds(sheet), [sheet]);
  const span = Math.max(...(["x", "y", "z"] as Axis[]).map((a) => bounds[a][1] - bounds[a][0]));
  const scale = (SIZE - 2 * PAD) / span;
  const mid = (axis: Axis) => (bounds[axis][0] + bounds[axis][1]) / 2;

  return (
    <div className="flex flex-wrap gap-2">
      {VIEWS.map((view) => {
        const h = (value: number) => SIZE / 2 + (value - mid(view.right)) * scale;
        const v = (value: number) => SIZE / 2 - (value - mid(view.up)) * scale;
        return (
          <figure key={view.name} className="m-0">
            <svg
              width={SIZE}
              height={SIZE}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              role="img"
              aria-label={`${view.name} view — click a part to open it in the sidebar`}
              style={{
                backgroundColor: token("page"),
                border: `0.5px solid ${token("line")}`,
                borderRadius: "var(--radius)",
              }}
            >
              {sheet.planes.map((plane) => {
                if (plane.axis == null || plane.offset == null || plane.axis === view.depth)
                  return null;
                const vertical = plane.axis === view.right;
                const at = vertical ? h(plane.offset) : v(plane.offset);
                const id = `plane:${plane.slug}`;
                return (
                  <Hit key={id} label={`plane ${plane.slug}`} onClick={() => onSelect(id)}>
                    <line
                      x1={vertical ? at : 0}
                      y1={vertical ? 0 : at}
                      x2={vertical ? at : SIZE}
                      y2={vertical ? SIZE : at}
                      stroke={selected === id ? token("ink") : token("line-2")}
                      strokeWidth={selected === id ? 1.4 : 0.75}
                    />
                  </Hit>
                );
              })}

              {sheet.solids.map((geo) => {
                const r = extent(geo, view.right);
                const u = extent(geo, view.up);
                if (!r || !u) return null;
                const id = `solid:${geo.slug}`;
                const on = selected === id;
                const paint = {
                  fill: geo.isVoid
                    ? "none"
                    : on
                      ? token("select")
                      : `color-mix(in srgb, ${token("ink")} 10%, transparent)`,
                  stroke: on ? token("ink") : token("ink-2"),
                  strokeWidth: on ? 1.6 : 1,
                  className: geo.isVoid ? "dash-void" : undefined,
                };
                return (
                  <Hit key={id} label={`solid ${geo.slug}`} onClick={() => onSelect(id)}>
                    {geo.isCyl && view.depth === "z" && geo.w != null ? (
                      <circle cx={h(0)} cy={v(0)} r={(geo.w / 2) * scale} {...paint} />
                    ) : (
                      <rect
                        x={Math.min(h(r[0]), h(r[1]))}
                        y={Math.min(v(u[0]), v(u[1]))}
                        width={Math.abs(h(r[1]) - h(r[0]))}
                        height={Math.abs(v(u[1]) - v(u[0]))}
                        {...paint}
                      />
                    )}
                  </Hit>
                );
              })}

              {sheet.frames.map((frame) => {
                const rv = frame.pos[view.right];
                const uv = frame.pos[view.up];
                if (rv == null || uv == null) return null;
                const id = `frame:${frame.slug}`;
                const on = selected === id;
                const cx = h(rv);
                const cy = v(uv);
                const ink = on ? token("ink") : token("ink-2");
                return (
                  <Hit key={id} label={`frame ${frame.slug}`} onClick={() => onSelect(id)}>
                    <line
                      x1={cx - 4}
                      y1={cy}
                      x2={cx + 4}
                      y2={cy}
                      stroke={ink}
                      strokeWidth={on ? 1.6 : 1}
                    />
                    <line
                      x1={cx}
                      y1={cy - 4}
                      x2={cx}
                      y2={cy + 4}
                      stroke={ink}
                      strokeWidth={on ? 1.6 : 1}
                    />
                  </Hit>
                );
              })}

              {sheet.conns.map((conn) => {
                const rv = conn.pos[view.right];
                const uv = conn.pos[view.up];
                if (rv == null || uv == null) return null;
                const id = `connector:${conn.slug}`;
                return (
                  <Hit key={id} label={`connector ${conn.slug}`} onClick={() => onSelect(id)}>
                    <ConnectorMark
                      conn={conn}
                      x={h(rv)}
                      y={v(uv)}
                      view={view}
                      scale={scale}
                      on={selected === id}
                    />
                  </Hit>
                );
              })}
            </svg>
            <figcaption>{view.name}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

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
  const stroke = on ? token("ink") : token("ink-2");
  const width = on ? 1.6 : 1;
  const axis = AXIS_VECTOR[conn.normal] ?? ([0, 0, 1] as const);
  const index: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
  const stub = (conn.stub ?? 0) * scale;
  return (
    <>
      <line
        x1={x}
        y1={y}
        x2={x + axis[index[view.right]] * stub}
        y2={y - axis[index[view.up]] * stub}
        stroke={stroke}
        strokeWidth={width}
      />
      <circle
        cx={x}
        cy={y}
        r={Math.max(2, ((conn.w ?? 4) / 2) * scale)}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
      />
    </>
  );
}
