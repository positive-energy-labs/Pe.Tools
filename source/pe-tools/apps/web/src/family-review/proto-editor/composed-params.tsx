/**
 * PROTOTYPE (round 3) — the HYBRID parameter surface: table skeleton × sentence vocabulary.
 *
 * The degree of hybrid, as built and as the report argues it:
 *   SKELETON from the table — one row per parameter, one column per type, real vertical alignment,
 *   sort/filter, and arrow-key navigation over the whole grid. These are the three powers, and all
 *   three need a grid; nothing about them survives a list of sentences.
 *   VOCABULARY from the sentence — every cell whose legal set is knowable is a scoped token, not a
 *   free field (the legal-options law), every cell states WHERE its value came from rather than
 *   just showing a number, and a refusal is written on the cell in words.
 *
 * WHERE THE GRID WINS AND THE SENTENCE LOSES: connective words. A sentence's `is a Length (Common)
 * parameter worth 24in` cannot be repeated 19 times down a column without becoming noise, so here
 * the words move into the header once. That is the one place this surface is a table and not a
 * sentence, and it is the correct trade for the cross-type read.
 *
 * ARROW-KEY NAV: the CELL owns focus (a `<td tabIndex>`), not the control inside it, so a picker
 * cell and a text cell navigate identically. Enter activates: a token opens its picker, a text cell
 * stops being read-only. Escape leaves editing. Arrows inside a live text edit move the caret, as
 * they must.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_VIEW,
  paramRows,
  viewRows,
  type ParamCell,
  type ParamRow,
  type SortKey,
} from "#/family-review/proto-editor/params";
import { setParamDataType } from "#/family-review/proto-editor/model";
import { RefToken, type Editor } from "#/family-review/proto-editor/shell";
import { setOverride, setParamFormula, setParamValue } from "#/family/family-model";

/** Where a value came from, in one word — the sentence's honesty inside the table's skeleton. */
const SOURCE_WORD: Record<ParamCell["source"], string> = {
  override: "set here",
  value: "inherits",
  formula: "computed",
  missing: "unset",
};

const SOURCE_TONE: Record<ParamCell["source"], string> = {
  override: "var(--pe-ink)",
  value: "var(--pe-ink-mute)",
  formula: "var(--pe-ink-2)",
  missing: "var(--pe-caution)",
};

const clamp = (value: number, hi: number) => Math.max(0, Math.min(value, hi));

export function ParamGrid({ editor }: { editor: Editor }) {
  const [view, setView] = useState(DEFAULT_VIEW);
  const [cursor, setCursor] = useState({ r: 0, c: 0 });
  const cells = useRef(new Map<string, HTMLTableCellElement>());

  const types = Object.keys(editor.model.types);
  const rows = useMemo(() => viewRows(paramRows(editor.model), view), [editor.model, view]);
  const columns = 3 + types.length;

  const pointerAt = (row: ParamRow | undefined, column: number): string | null => {
    if (!row) return null;
    if (column === 0) return row.pointer;
    if (column === 1) return `${row.pointer}/dataType`;
    if (column === 2) return row.base.pointer;
    return row.byType[types[column - 3] ?? ""]?.pointer ?? null;
  };

  // The cursor IS the cross-pane focus: moving it lights the json range, no extra gesture.
  const focusPointer = pointerAt(rows[cursor.r], cursor.c);
  useEffect(() => {
    cells.current.get(`${cursor.r}-${cursor.c}`)?.focus({ preventScroll: false });
  }, [cursor]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const key = event.key;
    if (!key.startsWith("Arrow")) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" && !(target as HTMLInputElement).readOnly) return;
    event.preventDefault();
    setCursor((at) => ({
      r: clamp(at.r + (key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0), rows.length - 1),
      c: clamp(at.c + (key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0), columns - 1),
    }));
  };

  const head = (label: string, sort: SortKey | null, span?: string) => (
    <th
      key={label}
      scope="col"
      className="t-caption t-upper px-2 py-1 text-left font-normal text-[var(--pe-ink-mute)]"
      style={{ borderBottom: "1px solid var(--pe-line)", whiteSpace: "nowrap" }}
    >
      {sort == null ? (
        <span>{label}</span>
      ) : (
        <button
          type="button"
          title={`Sort by ${label}`}
          onClick={() =>
            setView((prev) => ({
              ...prev,
              sort,
              descending: prev.sort === sort ? !prev.descending : false,
            }))
          }
          className="t-caption t-upper"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "inherit",
            padding: 0,
          }}
        >
          {label}
          {view.sort === sort ? (view.descending ? " ↓" : " ↑") : ""}
        </button>
      )}
      {span ? <span className="block font-normal normal-case">{span}</span> : null}
    </th>
  );

  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="t-label t-upper text-[var(--pe-ink-2)]">parameters</span>
        <span className="t-caption text-[var(--pe-ink-mute)]">
          {rows.length} of {Object.keys(editor.model.familyParameters).length} · one column per type
        </span>
        <input
          value={view.query}
          onChange={(event) => setView((prev) => ({ ...prev, query: event.target.value }))}
          placeholder="filter"
          title="Filter rows by name, data type or base value"
          className="face-mono t-label"
          style={{
            width: 120,
            padding: "0 4px",
            background: "transparent",
            border: "none",
            borderBottom: "0.5px solid var(--pe-line-2)",
            borderRadius: 0,
            color: "var(--pe-ink)",
          }}
        />
        <label className="t-caption flex items-baseline gap-1 text-[var(--pe-ink-2)]">
          <input
            type="checkbox"
            checked={view.overriddenOnly}
            onChange={(event) =>
              setView((prev) => ({ ...prev, overriddenOnly: event.target.checked }))
            }
          />
          only rows a type overrides
        </label>
        <span className="t-caption text-[var(--pe-ink-mute)]">arrow keys move · enter edits</span>
      </div>

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the grid owns
          roving focus; every cell is individually focusable and activates on Enter. */}
      <table
        className="w-full"
        style={{ borderCollapse: "collapse" }}
        onKeyDown={onKeyDown}
        onFocus={() => editor.setFocus(focusPointer)}
      >
        <thead>
          <tr>
            {head("parameter", "name")}
            {head("data type", "dataType")}
            {head("base value", "base")}
            {types.map((typeName) => head(typeName, null, "type"))}
            {head("reads", "reads")}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.name} style={{ borderBottom: "1px solid var(--pe-line)" }}>
              <Cell
                r={r}
                c={0}
                cursor={cursor}
                cells={cells}
                onPick={() => setCursor({ r, c: 0 })}
                focused={
                  editor.focus === row.pointer ||
                  (editor.focus?.startsWith(`${row.pointer}/`) ?? false)
                }
              >
                <span className="face-mono t-label text-[var(--pe-ink)]">{row.name}</span>
              </Cell>

              <Cell r={r} c={1} cursor={cursor} cells={cells} onPick={() => setCursor({ r, c: 1 })}>
                <RefToken
                  editor={editor}
                  value={row.dataType}
                  kind="dataType"
                  title="Retype the parameter. Live: a parameter that stops being a Length leaves every length picker on this page in the same render."
                  extra={[row.dataType]}
                  onPick={(next) =>
                    editor.apply((model) => setParamDataType(model, row.section, row.name, next))
                  }
                />
              </Cell>

              <Cell r={r} c={2} cursor={cursor} cells={cells} onPick={() => setCursor({ r, c: 2 })}>
                <GridText
                  cell={row.base}
                  title={
                    row.base.source === "formula"
                      ? `Rewrite ${row.name}'s formula`
                      : `Write ${row.name}'s family value — a portable literal (24in, 2 1/2in, 600mm)`
                  }
                  onCommit={(text) =>
                    editor.apply((model) =>
                      row.base.source === "formula"
                        ? setParamFormula(model, row.name, text.replace(/^=\s*/, ""))
                        : setParamValue(model, row.name, text),
                    )
                  }
                />
              </Cell>

              {types.map((typeName, index) => {
                const cell = row.byType[typeName];
                if (!cell) return null;
                return (
                  <Cell
                    key={typeName}
                    r={r}
                    c={3 + index}
                    cursor={cursor}
                    cells={cells}
                    onPick={() => setCursor({ r, c: 3 + index })}
                  >
                    <GridText
                      cell={cell}
                      title={
                        cell.lock ??
                        `Override ${row.name} for the ${typeName} type. Empty clears the override and the cell goes back to inheriting.`
                      }
                      onCommit={(text) =>
                        editor.apply((model) =>
                          setOverride(model, typeName, row.name, text.trim() === "" ? null : text),
                        )
                      }
                    />
                  </Cell>
                );
              })}

              <td
                className="face-mono t-caption px-2 py-0.5 text-right tabular-nums text-[var(--pe-ink-mute)]"
                title="Authored constructs that read this parameter"
              >
                {row.reads > 0 ? row.reads : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <p className="t-caption px-2 py-2 text-[var(--pe-ink-mute)]">
          no parameter matches — clear the filter
        </p>
      ) : null}
    </section>
  );
}

function Cell({
  r,
  c,
  cursor,
  cells,
  onPick,
  focused,
  children,
}: {
  r: number;
  c: number;
  cursor: { r: number; c: number };
  cells: React.RefObject<Map<string, HTMLTableCellElement>>;
  onPick: () => void;
  focused?: boolean;
  children: React.ReactNode;
}) {
  const on = cursor.r === r && cursor.c === c;
  return (
    <td
      ref={(node) => {
        if (node) cells.current.set(`${r}-${c}`, node);
        else cells.current.delete(`${r}-${c}`);
      }}
      tabIndex={on ? 0 : -1}
      onFocus={onPick}
      onClick={onPick}
      className="px-2 py-0.5 align-baseline"
      style={{
        background: on || focused ? "var(--pe-select)" : "transparent",
        outline: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}

/** A value cell: read-only until you mean it, so arrow keys belong to the grid until Enter. */
function GridText({
  cell,
  title,
  onCommit,
}: {
  cell: ParamCell;
  title: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft != null;
  const locked = cell.lock != null;

  return (
    <span className="flex items-baseline gap-1">
      <input
        readOnly={!editing || locked}
        value={draft ?? cell.text}
        title={title}
        onChange={(event) => setDraft(event.target.value)}
        onDoubleClick={() => !locked && setDraft(cell.text)}
        onKeyDown={(event) => {
          if (locked) return;
          if (event.key === "Enter" && !editing) {
            event.preventDefault();
            setDraft(cell.text);
          } else if (event.key === "Enter" && editing) {
            event.preventDefault();
            if (draft !== cell.text) onCommit(draft ?? "");
            setDraft(null);
          } else if (event.key === "Escape") {
            setDraft(null);
          }
        }}
        onBlur={() => {
          if (editing && draft !== cell.text) onCommit(draft ?? "");
          setDraft(null);
        }}
        className="face-mono t-label"
        style={{
          width: 84,
          padding: "0 2px",
          background: editing ? "var(--pe-page)" : "transparent",
          border: "none",
          borderBottom: editing ? "0.5px solid var(--pe-ink)" : "0.5px solid transparent",
          borderRadius: 0,
          color: locked ? "var(--pe-ink-mute)" : SOURCE_TONE[cell.source],
          cursor: locked ? "not-allowed" : "text",
        }}
      />
      <span className="t-caption text-[var(--pe-ink-mute)]">
        {locked ? "locked" : SOURCE_WORD[cell.source]}
      </span>
    </span>
  );
}
