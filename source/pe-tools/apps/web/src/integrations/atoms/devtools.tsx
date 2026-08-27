import { RegistryContext } from "@effect/atom-react";
import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  getInspectableAtomStore,
  inspectAtomRegistry,
  subscribeInspectableAtomStore,
  type InspectSnapshot,
} from "#/state/atom-inspect";

import type { TanStackDevtoolsReactPlugin } from "@tanstack/react-devtools";
import { Verb } from "#/components/lang/verb";

const styles = `
.atoms { box-sizing:border-box; display:grid; grid-template-rows:auto minmax(0,1fr); height:100%; padding:12px; overflow:auto; font:12px ui-monospace,monospace }
.atoms header,.atoms .actions { display:flex; gap:8px; align-items:center }
.atoms main { display:grid; grid-template-columns:minmax(420px,2fr) minmax(260px,1fr); min-height:0 }
.atoms .scroll,.atoms aside { overflow:auto }
.atoms aside { border-left:1px solid color-mix(in srgb,currentColor 20%,transparent); padding-left:12px }
.atoms table { width:100%; border-collapse:collapse }
.atoms th,.atoms td { padding:4px 8px; text-align:left; white-space:nowrap }
.atoms tr { cursor:pointer }.atoms tr[data-selected=true] { background:color-mix(in srgb,currentColor 12%,transparent) }
.atoms input,.atoms select,.atoms button { border:1px solid color-mix(in srgb,currentColor 30%,transparent); border-radius:4px; padding:4px 6px; background:transparent; color:inherit }
`;

function AtomsPanel() {
  const panel = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const registry = useContext(RegistryContext);
  const store = useSyncExternalStore(
    subscribeInspectableAtomStore,
    getInspectableAtomStore,
    getInspectableAtomStore,
  );
  const fallback = useMemo(() => inspectAtomRegistry(registry), [registry]);
  const inspector = store?.inspector ?? fallback;
  const [snapshot, setSnapshot] = useState<InspectSnapshot>(() => inspector.snapshot());
  const [prefix, setPrefix] = useState("");
  const [sort, setSort] = useState<"recomputes" | "lastChangeAt">("recomputes");
  const [selected, setSelected] = useState<string | null>(null);
  const [nextValue, setNextValue] = useState("");

  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const update = () => setVisible(element.getClientRects().length > 0);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // FOOTGUN: TanStack keeps hidden plugin panels mounted. Polling the full registry while this
    // panel was hidden made fixture-table hover cost about 600 ms of script per row transition.
    if (!visible) return;
    setSnapshot(inspector.snapshot());
    const unsubscribe = inspector.subscribe(() => setSnapshot(inspector.snapshot()));
    if (import.meta.env.DEV) Object.assign(globalThis, { __PE_ATOMS__: inspector });
    return () => {
      unsubscribe();
      if (!store) inspector.dispose();
      if ((globalThis as { __PE_ATOMS__?: unknown }).__PE_ATOMS__ === inspector)
        Reflect.deleteProperty(globalThis, "__PE_ATOMS__");
    };
  }, [inspector, store, visible]);

  const rows = snapshot.nodes
    .filter(({ label }) => label.startsWith(prefix))
    .sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1) || a.label.localeCompare(b.label));
  const node = snapshot.nodes.find(({ id }) => id === selected);

  return (
    <div ref={panel} className="atoms">
      <style>{styles}</style>
      <header>
        <strong>Atoms</strong>
        <span>
          {snapshot.census.nodes} nodes · {snapshot.census.edges} edges ·{" "}
          {snapshot.census.subscribed} subscribed
        </span>
        <label>
          Prefix{" "}
          <input
            aria-label="Filter by label prefix"
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
          />
        </label>
        <label>
          Sort{" "}
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="recomputes">recomputes</option>
            <option value="lastChangeAt">last change</option>
          </select>
        </label>
      </header>

      <main>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                {["label", "state", "deps", "kids", "subs", "recomputes", "last change"].map(
                  (name) => (
                    <th key={name}>{name}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-selected={row.id === selected}
                  onClick={() => setSelected(row.id)}
                >
                  <td>{row.label}</td>
                  <td>{row.state}</td>
                  <td>{row.parents.length}</td>
                  <td>{row.children.length}</td>
                  <td>{row.listeners}</td>
                  <td>{row.recomputes}</td>
                  <td>
                    {row.lastChangeAt ? new Date(row.lastChangeAt).toLocaleTimeString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside>
          {node ? (
            <>
              <h3>{node.label}</h3>
              <div>{node.source ?? "no Atom.withLabel source"}</div>
              <p>
                <b>Value</b>
                <br />
                {node.value ?? "unavailable while not valid"}
              </p>
              <p>
                <b>Parents</b>
                <br />
                {node.parents.join(", ") || "none"}
              </p>
              <p>
                <b>Children</b>
                <br />
                {node.children.join(", ") || "none"}
              </p>
              <div className="actions">
                <Verb
                  label="Refresh"
                  reason="Refresh the selected atom snapshot."
                  onClick={() => inspector.refresh(node.id)}
                />
                <input
                  aria-label="New primitive value"
                  value={nextValue}
                  onChange={(event) => setNextValue(event.target.value)}
                  disabled={!node.writable}
                />
                <Verb
                  label="Set"
                  reason="Set the selected atom to the entered primitive value."
                  disabled={!node.writable}
                  onClick={() => inspector.set(node.id, nextValue)}
                />
              </div>
            </>
          ) : (
            <p>Select an atom.</p>
          )}
          <h3>Last 20 changes</h3>
          <ol>
            {snapshot.changes
              .slice(-20)
              .reverse()
              .map((change) => (
                <li key={`${change.at}-${change.id}`}>
                  {change.label}:{" "}
                  {change.cause ? `${change.cause.verb} ${change.cause.key}` : "unknown cause"}
                </li>
              ))}
          </ol>
        </aside>
      </main>
    </div>
  );
}

export default { name: "Atoms", render: <AtomsPanel /> } satisfies TanStackDevtoolsReactPlugin;
