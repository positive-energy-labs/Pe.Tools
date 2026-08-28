import { token } from "#/lib/token";
/**
 * PROTOTYPE (round 2 · piece 3) — PARADIGM A · ANCHOR-FIRST / RELATION GRAPH.
 *
 * THE CLAIM: you never edit a thing in isolation. Pick any datum — a plane, a face, a frame, a
 * parameter — and the surface shows BOTH directions at once: everything that thing is defined
 * FROM, and everything defined OFF it. Editing is walking: every reference on the page is a door
 * to the node it names, so "where does this number come from" is one click and never a search.
 *
 * WHAT THIS PARADIGM CAN DO THAT A GENERATED FORM CANNOT: re-anchor. A form knows a plane has a
 * `from` field; it does not know that four frames and two solids hang off THIS plane, so it can
 * offer you a rename and silently leave six dependents pointing at the old datum. Here the
 * dependent list is the surface, and moving all of them is one action with a stated blast radius.
 *
 * Deliberately NOT a node-and-wire canvas. A wire diagram of the showcase (19 parameters, 3
 * planes, 4 frames, 4 solids, 4 connectors) is a hairball you pan around; this is the same graph
 * read one node at a time, which is how you actually ask questions of it.
 */
import { useMemo, useState } from "react";

import { Verb } from "#/components/lang/verb";
import { fieldsOf } from "#/family-review/proto-editor/fields";
import {
  anchors,
  dependents,
  familyGraph,
  nodeValue,
  overriddenBy,
  provenance,
  retarget,
  type GraphNode,
  type NodeKind,
  type SlotKind,
} from "#/family-review/proto-editor/model";
import { RefToken, TextToken, type Editor } from "#/family-review/proto-editor/shell";
import { Press } from "#/components/lang/press";

const RAIL_ORDER: NodeKind[] = [
  "param",
  "datum-plane",
  "plane",
  "solid",
  "face",
  "frame",
  "connector",
  "nested",
  "array",
];

const RAIL_LABEL: Record<NodeKind, string> = {
  param: "parameters",
  "datum-plane": "stock planes",
  plane: "planes",
  solid: "solids",
  face: "faces in use",
  frame: "frames",
  connector: "connectors",
  nested: "nested families",
  array: "arrays",
};

/** What a node of this kind may be REPLACED BY when its dependents are re-anchored. */
const REANCHOR_SLOT: Partial<Record<NodeKind, SlotKind>> = {
  param: "lengthParam",
  "datum-plane": "anchor",
  plane: "anchor",
  face: "anchor",
  frame: "frame",
};

export function ParadigmA({ editor }: { editor: Editor }) {
  const [anchor, setAnchor] = useState("plane:return-elevation");
  const graph = useMemo(() => familyGraph(editor.model), [editor.model]);
  const [reanchorTo, setReanchorTo] = useState("");

  const node = graph.byId.get(anchor);
  const from = anchors(graph, anchor);
  const off = dependents(graph, anchor);
  const fields = fieldsOf(editor.model, anchor);
  const chains = provenance(graph, anchor).filter((chain) => chain.length > 1);
  const slot = node ? REANCHOR_SLOT[node.kind] : undefined;

  const Walk = ({ id, label }: { id: string; label: string }) => (
    <Press
      type="button"
      title={`Make ${id} the anchor — the same two-direction view, one step along the graph`}
      onClick={() => setAnchor(id)}
      className="face-mono t-label"
      style={{
        background: "transparent",
        border: "none",
        borderBottom: `0.5px solid ${token("line-2")}`,
        borderRadius: 0,
        cursor: "pointer",
        color: token("nav"),
        padding: 0,
      }}
    >
      {label}
    </Press>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* the index — every datum in the document, with its blast radius */}
      <nav
        className="min-h-0 w-64 shrink-0 overflow-auto border-r px-2 py-2"
        style={{ borderColor: token("line") }}
      >
        {RAIL_ORDER.map((kind) => {
          const group = graph.nodes.filter((entry) => entry.kind === kind);
          if (group.length === 0) return null;
          return (
            <div key={kind} className="mb-3">
              <div className="t-caption t-upper mb-1 text-ink-mute">{RAIL_LABEL[kind]}</div>
              {group.map((entry) => (
                <RailRow
                  key={entry.id}
                  node={entry}
                  count={dependents(graph, entry.id).length}
                  current={entry.id === anchor}
                  onPick={() => setAnchor(entry.id)}
                />
              ))}
            </div>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {node == null ? (
          <p className="t-prose text-ink-2">
            {anchor} is not in the document — pick a datum on the left.
          </p>
        ) : (
          <>
            <header className="mb-3">
              <div className="flex items-baseline gap-2">
                <span className="face-mono t-title text-ink">{node.label}</span>
                <span className="t-label text-ink-mute">{RAIL_LABEL[node.kind]}</span>
                {nodeValue(editor.model, editor.typeName, node.id) != null ? (
                  <span className="face-mono t-value text-ink-2">
                    = {nodeValue(editor.model, editor.typeName, node.id)}
                  </span>
                ) : null}
              </div>
              <div className="face-mono t-caption text-ink-mute">
                {node.id} · {node.detail}
              </div>
              {overriddenBy(editor.model, node.id).length > 0 ? (
                <div className="t-caption mt-0.5 text-caution">
                  overridden by type: {overriddenBy(editor.model, node.id).join(" · ")}
                </div>
              ) : null}
            </header>

            {/* ── DEFINED FROM ─────────────────────────────────────────────────────────────── */}
            <section className="mb-4">
              <div className="t-label t-upper mb-1 text-ink-2">
                defined from — {from.length} reference{from.length === 1 ? "" : "s"}
              </div>
              {fields.length === 0 ? (
                <p className="t-caption text-ink-mute">
                  stock datum — the template owns it, nothing here is authored
                </p>
              ) : (
                <table className="w-full">
                  <tbody>
                    {fields.map((field) => (
                      <tr key={field.key}>
                        <td className="face-mono t-label w-28 py-0.5 align-baseline text-ink-mute">
                          {field.key}
                        </td>
                        <td className="py-0.5 align-baseline">
                          {field.slot === "text" ? (
                            <TextToken
                              value={field.value}
                              title={`Write ${field.key} on ${node.id}`}
                              width={160}
                              onCommit={(text) => editor.apply((model) => field.write(model, text))}
                            />
                          ) : (
                            <RefToken
                              editor={editor}
                              value={field.value}
                              kind={field.slot}
                              title={`Point ${node.id}'s ${field.key} at another datum — the dependents below do not move with it`}
                              extra={field.value ? [field.value] : undefined}
                              onPick={(ref) => editor.apply((model) => field.write(model, ref))}
                            />
                          )}
                        </td>
                        <td className="py-0.5 pl-2 align-baseline">
                          {field.relation && graph.byId.has(field.value) ? (
                            <Walk id={field.value} label="→ open" />
                          ) : null}
                        </td>
                        <td className="face-mono t-caption py-0.5 pl-2 align-baseline text-ink-mute">
                          {nodeValue(editor.model, editor.typeName, field.value) ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* ── DEFINED OFF IT ───────────────────────────────────────────────────────────── */}
            <section className="mb-4">
              <div className="t-label t-upper mb-1 text-ink-2">
                defined off it — {off.length} dependent{off.length === 1 ? "" : "s"}
              </div>
              {off.length === 0 ? (
                <p className="t-caption text-ink-mute">
                  nothing reads this — changing it moves nothing else in the document
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {off.map((edge) => (
                    <li key={`${edge.from}/${edge.field}`} className="flex items-baseline gap-2">
                      <Walk id={edge.from} label={edge.from} />
                      <span className="face-mono t-caption text-ink-mute">
                        · {edge.field}
                        {edge.to === anchor ? "" : ` (via ${edge.to})`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {slot != null && off.length > 0 ? (
                <div
                  className="mt-2 flex flex-wrap items-baseline gap-2 border-t pt-2"
                  style={{ borderColor: token("line") }}
                >
                  <span className="t-caption text-ink-2">re-anchor all of them onto</span>
                  <RefToken
                    editor={editor}
                    value={reanchorTo}
                    kind={slot}
                    title="The datum every dependent above will point at instead"
                    onPick={setReanchorTo}
                  />
                  <Verb
                    label={`re-anchor ${off.filter((edge) => edge.write).length}`}
                    reason={
                      reanchorTo === ""
                        ? "Pick the datum to move them onto first"
                        : `Rewrite ${off.filter((edge) => edge.write).length} authored field(s) from ${anchor} to ${reanchorTo}. Structural links (a face belongs to its solid) cannot move and are left alone.`
                    }
                    disabled={reanchorTo === ""}
                    onClick={() =>
                      editor.apply((model) => retarget(graph, model, anchor, reanchorTo).model)
                    }
                  />
                </div>
              ) : null}
            </section>

            {/* ── WHERE THE NUMBER COMES FROM ──────────────────────────────────────────────── */}
            {chains.length > 0 ? (
              <section>
                <div className="t-label t-upper mb-1 text-ink-2">comes from</div>
                <ul className="space-y-0.5">
                  {chains.map((chain) => (
                    <li key={chain.join(">")} className="face-mono t-caption text-ink-2">
                      {chain.join("  ←  ")}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function RailRow({
  node,
  count,
  current,
  onPick,
}: {
  node: GraphNode;
  count: number;
  current: boolean;
  onPick: () => void;
}) {
  return (
    <Press
      type="button"
      title={`${node.id} — ${node.detail}`}
      onClick={onPick}
      className="flex w-full items-baseline justify-between gap-2 px-1 py-0.5 text-left"
      style={{
        background: current ? token("select") : "transparent",
        border: "none",
        borderRadius: 2,
        cursor: "pointer",
      }}
    >
      <span className="face-mono t-label truncate text-ink">{node.label}</span>
      <span className="face-mono t-caption text-ink-mute">{count > 0 ? count : ""}</span>
    </Press>
  );
}
