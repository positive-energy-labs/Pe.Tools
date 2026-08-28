import { token } from "#/lib/token";
/**
 * PROTOTYPE (round 3) — the middle and bottom of the composed page.
 *
 * MIDDLE · triptych + sidebar. Paradigm B reduced to the honest part: the drawing is a VIEW, never
 * a form. Click any element and the sidebar beside it shows that element's INPUTS (scoped tokens)
 * plus both directions of the graph — what it is defined FROM and what is defined OFF it, each one
 * clickable. That is paradigm A's provenance click, living where round 2 said it should. The banner
 * stays until the drawing is trustworthy: this is `/family`'s v1 evaluator, which does not apply
 * `frame` to a solid, and a surface that hid that would be drawing a confident lie.
 *
 * BOTTOM · the everything-else "table": paradigm C's sentences under `sentences.ts`'s shared slot
 * templates, laid out on ONE css grid per kind so every token slot lines up down the page. The
 * connective words stay in the rows — that is what keeps it a sentence rather than a table.
 */
import { useMemo } from "react";

import { EmptyState } from "#/components/lang/empty";
import { Verb } from "#/components/lang/verb";
import { fieldsOf } from "#/family-review/proto-editor/fields";
import {
  addSolid,
  anchors,
  dependents,
  familyGraph,
  nodeValue,
} from "#/family-review/proto-editor/model";
import { sentenceGroups, type SentenceCell } from "#/family-review/proto-editor/sentences";
import { RefToken, TextToken, type Editor } from "#/family-review/proto-editor/shell";
import {
  buildSheet,
  sheetBounds,
  type Axis,
  type ConnGeo,
  type SolidGeo,
} from "#/family/family-model";
import { Press } from "#/components/lang/press";

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
                background: token("page"),
                border: `0.5px solid ${token("line")}`,
                borderRadius: 2,
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
                  strokeDasharray: geo.isVoid ? "4 3" : undefined,
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
            <figcaption className="t-caption text-ink-mute">{view.name}</figcaption>
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

// ── the sidebar: this element's inputs, and both directions of the graph ────────────────────────

export function PartSidebar({
  editor,
  selected,
  onSelect,
}: {
  editor: Editor;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const graph = useMemo(() => familyGraph(editor.model), [editor.model]);
  const node = selected ? graph.byId.get(selected) : undefined;
  const fields = selected ? fieldsOf(editor.model, selected) : [];

  if (!node)
    return (
      <div className="w-72 shrink-0 px-3">
        <EmptyState story="scope" exit="click a solid, plane, frame or connector in the drawing">
          nothing picked
        </EmptyState>
      </div>
    );

  const walk = (id: string) => (
    <Press
      type="button"
      onClick={() => onSelect(id)}
      title={`Open ${id} — same sidebar, one step along the graph`}
      className="face-mono t-caption text-left"
      style={{
        background: "none",
        border: "none",
        borderBottom: `0.5px solid ${token("line-2")}`,
        borderRadius: 0,
        color: token("nav"),
        cursor: "pointer",
        padding: 0,
      }}
    >
      {id}
    </Press>
  );

  return (
    <div className="w-72 shrink-0 overflow-auto px-3">
      <div className="face-mono t-value text-ink">{node.id}</div>
      <div className="t-caption mb-2 text-ink-mute">{node.detail}</div>

      <div className="t-caption t-upper mb-1 text-ink-2">its inputs</div>
      {fields.length === 0 ? (
        <p className="t-caption text-ink-mute">
          stock datum — the template owns it, nothing here is authored
        </p>
      ) : (
        <table className="w-full">
          <tbody>
            {fields.map((field) => (
              <tr key={field.key}>
                <td className="face-mono t-caption w-20 py-0.5 align-baseline text-ink-mute">
                  {field.key}
                </td>
                <td className="py-0.5 align-baseline">
                  {field.slot === "text" ? (
                    <TextToken
                      value={field.value}
                      title={`Write ${field.key} on ${node.id}`}
                      width={130}
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
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="t-caption t-upper mb-1 mt-3 text-ink-2">defined from</div>
      <ul className="space-y-0.5">
        {anchors(graph, node.id).map((edge) => (
          <li key={`${edge.field}->${edge.to}`} className="flex items-baseline gap-1">
            <span className="face-mono t-caption text-ink-mute">{edge.field}</span>
            {walk(edge.to)}
            <span className="face-mono t-caption text-ink-mute">
              {nodeValue(editor.model, editor.typeName, edge.to) ?? ""}
            </span>
          </li>
        ))}
        {anchors(graph, node.id).length === 0 ? (
          <li className="t-caption text-ink-mute">nothing — it is a root</li>
        ) : null}
      </ul>

      <div className="t-caption t-upper mb-1 mt-3 text-ink-2">defined off it</div>
      <ul className="space-y-0.5">
        {dependents(graph, node.id).map((edge) => (
          <li key={`${edge.from}/${edge.field}`} className="flex items-baseline gap-1">
            {walk(edge.from)}
            <span className="face-mono t-caption text-ink-mute">· {edge.field}</span>
          </li>
        ))}
        {dependents(graph, node.id).length === 0 ? (
          <li className="t-caption text-ink-mute">
            nothing reads this — changing it moves nothing else
          </li>
        ) : null}
      </ul>
    </div>
  );
}

// ── the everything-else "table": aligned sentences ──────────────────────────────────────────────

export function SentenceGrids({
  editor,
  selected,
  onSelect,
  draft,
  setDraft,
}: {
  editor: Editor;
  selected: string | null;
  onSelect: (id: string) => void;
  draft: string;
  setDraft: (name: string) => void;
}) {
  const groups = useMemo(() => sentenceGroups(editor.model), [editor.model]);
  const focused = (pointer: string) =>
    editor.focus != null && (editor.focus === pointer || editor.focus.startsWith(`${pointer}/`));

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <section key={group.key}>
          <div className="t-label t-upper mb-1 text-ink-2">{group.label}</div>
          {group.rows.length === 0 ? (
            <EmptyState story="scope" exit={group.exit}>
              this family has no {group.label}
            </EmptyState>
          ) : (
            <div
              className="grid gap-x-2 gap-y-0.5"
              style={{ gridTemplateColumns: `repeat(${group.slots.length}, max-content)` }}
            >
              {group.rows.map((row) =>
                row.cells.map((cell) => (
                  <div
                    key={`${row.id}/${cell.slot}`}
                    className="flex items-baseline gap-1 px-1"
                    style={{
                      background:
                        selected === row.id || focused(row.pointer)
                          ? token("select")
                          : "transparent",
                    }}
                  >
                    <SlotCell editor={editor} cell={cell} rowId={row.id} onSelect={onSelect} />
                  </div>
                )),
              )}
            </div>
          )}
          {group.key === "solids" ? (
            <div className="mt-1 flex items-baseline gap-2">
              <TextToken
                value={draft}
                width={110}
                title="Name for a new solid — the slug every other sentence will refer to"
                onCommit={setDraft}
              />
              <Verb
                label="author solid"
                reason={
                  draft === ""
                    ? "Name it first — the slug is how every other sentence will refer to it"
                    : editor.model.solids?.[draft] != null
                      ? `A solid called ${draft} already exists`
                      : `Add an unbound solid row called ${draft}; the dimension columns stay empty until its kind binds`
                }
                disabled={draft === "" || editor.model.solids?.[draft] != null}
                onClick={() => {
                  editor.apply((model) => addSolid(model, draft));
                  setDraft("");
                }}
              />
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function SlotCell({
  editor,
  cell,
  rowId,
  onSelect,
}: {
  editor: Editor;
  cell: SentenceCell;
  rowId: string;
  onSelect: (id: string) => void;
}) {
  if (cell.kind === "blank") return null;

  if (cell.kind === "name")
    return (
      <Press
        type="button"
        onClick={() => {
          onSelect(rowId);
          editor.setFocus(cell.pointer ?? null);
        }}
        title={`Show ${rowId} in the drawing and the json`}
        className="face-mono t-label"
        style={{
          background: "none",
          border: "none",
          borderRadius: 0,
          cursor: "pointer",
          color: token("ink"),
          fontWeight: 600,
          padding: 0,
        }}
      >
        {cell.value}
      </Press>
    );

  if (cell.kind === "text" && cell.write == null)
    return (
      <span className={cell.pointer ? "face-mono t-label text-ink-2" : "t-label text-ink-mute"}>
        {cell.lead ? `${cell.lead} ` : ""}
        {cell.value}
      </span>
    );

  if (cell.kind === "text")
    return (
      <>
        {cell.lead ? <span className="t-label text-ink-mute">{cell.lead}</span> : null}
        <TextToken
          value={cell.value}
          width={90}
          title={cell.title ?? "Write this value"}
          onCommit={(text) => editor.apply((model) => cell.write?.(model, text) ?? model)}
        />
      </>
    );

  return (
    <>
      {cell.lead ? <span className="t-label text-ink-mute">{cell.lead}</span> : null}
      <RefToken
        editor={editor}
        value={cell.value}
        kind={cell.slotKind ?? "lengthParam"}
        title={cell.title ?? "Pick from what is legal here"}
        extra={cell.value ? [cell.value] : undefined}
        onPick={(ref) => {
          editor.setFocus(cell.pointer ?? null);
          editor.apply((model) => cell.write?.(model, ref) ?? model);
        }}
      />
      {nodeValue(editor.model, editor.typeName, cell.value) != null ? (
        <span className="face-mono t-caption text-ink-mute">
          {nodeValue(editor.model, editor.typeName, cell.value)}
        </span>
      ) : null}
    </>
  );
}
