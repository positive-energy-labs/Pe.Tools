/**
 * The composed editor's provenance sidebar and aligned sentence regions.
 */
import { useMemo } from "react";

import { EmptyState } from "#/components/lang/empty";
import { Press } from "#/components/lang/press";
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
import { token } from "#/lib/token";

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
      <div className="w-72 px-3">
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
      style={{
        backgroundColor: "transparent",
        backgroundImage: "none",
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
    <div className="w-72 overflow-auto px-3">
      <div>{node.id}</div>
      <div className="mb-2">{node.detail}</div>

      <div className="mb-1">its inputs</div>
      {fields.length === 0 ? (
        <p>stock datum — the template owns it, nothing here is authored</p>
      ) : (
        <table className="w-full">
          <tbody>
            {fields.map((field) => (
              <tr key={field.key}>
                <td className="w-20 py-0.5">{field.key}</td>
                <td className="py-0.5">
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

      <div className="mb-1 mt-3">defined from</div>
      <ul>
        {anchors(graph, node.id).map((edge) => (
          <li key={`${edge.field}->${edge.to}`} className="flex items-baseline gap-1">
            <span>{edge.field}</span>
            {walk(edge.to)}
            <span>{nodeValue(editor.model, editor.typeName, edge.to) ?? ""}</span>
          </li>
        ))}
        {anchors(graph, node.id).length === 0 ? <li>nothing — it is a root</li> : null}
      </ul>

      <div className="mb-1 mt-3">defined off it</div>
      <ul>
        {dependents(graph, node.id).map((edge) => (
          <li key={`${edge.from}/${edge.field}`} className="flex items-baseline gap-1">
            {walk(edge.from)}
            <span>· {edge.field}</span>
          </li>
        ))}
        {dependents(graph, node.id).length === 0 ? (
          <li>nothing reads this — changing it moves nothing else</li>
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
          <div className="mb-1">{group.label}</div>
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
                    data-selected={selected === row.id || focused(row.pointer) ? "" : undefined}
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
        style={{
          backgroundColor: "transparent",
          backgroundImage: "none",
          border: "none",
          borderRadius: 0,
          cursor: "pointer",
          color: token("ink"),
          fontWeight: "var(--weight-strong)",
          padding: 0,
        }}
      >
        {cell.value}
      </Press>
    );

  if (cell.kind === "text" && cell.write == null)
    return (
      <span>
        {cell.lead ? `${cell.lead} ` : ""}
        {cell.value}
      </span>
    );

  if (cell.kind === "text")
    return (
      <>
        {cell.lead ? <span>{cell.lead}</span> : null}
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
      {cell.lead ? <span>{cell.lead}</span> : null}
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
        <span>{nodeValue(editor.model, editor.typeName, cell.value)}</span>
      ) : null}
    </>
  );
}
