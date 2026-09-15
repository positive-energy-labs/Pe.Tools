import { useState } from "react";
import {
  capabilityCatalogSchema,
  capabilityMap,
  findCapabilities,
  type Address,
  type Capability,
  type CapabilityCatalog,
} from "@pe/agent-contracts";
import { FactChip } from "#/components/lang/chip";
import { useHostCall } from "#/readings";

/** The same rows pe_find ranks, rendered for the human. `GET /pe/capabilities`, no Revit needed. */
export function CapabilityCatalogSection({
  fixture,
  document,
}: {
  fixture?: CapabilityCatalog;
  /** The page's document; the host derives the session from its holder. */
  document?: Address | null;
}) {
  const [query, setQuery] = useState("");
  const live = useHostCall(
    async () => {
      const search = document ? `?doc=${encodeURIComponent(document)}` : "";
      const response = await fetch(`/pe/capabilities${search}`);
      if (!response.ok) throw new Error(`GET /pe/capabilities ${response.status}`);
      return capabilityCatalogSchema.parse(await response.json());
    },
    ["pe", "capabilities", document ?? ""],
    !fixture,
  );
  const catalog = fixture ?? live.data;
  if (!catalog)
    return (
      <section className="flex flex-col gap-2" data-testid="capability-catalog">
        <h2>Capabilities</h2>
        <p className="text-ink-2">
          {live.error ? String(live.error) : "reading the capability catalog…"}
        </p>
      </section>
    );
  const rows = query.trim()
    ? findCapabilities(catalog.capabilities, { query, limit: 30 })
    : catalog.capabilities.slice(0, 30);
  const map = capabilityMap(catalog.capabilities);
  return (
    <section className="flex flex-col gap-3" data-testid="capability-catalog">
      <header className="flex flex-wrap items-center gap-2">
        <h2>Capabilities</h2>
        <FactChip title="rows pe_find ranks, pe_read and pe_do run">{map.total} rows</FactChip>
        {map.kinds.map((kind) => (
          <FactChip key={kind.kind} dashed title={`${kind.mutating} mutating`}>
            {kind.kind} {kind.count}
          </FactChip>
        ))}
        <input
          type="search"
          aria-label="Find a capability"
          className="ml-auto min-w-48"
          placeholder="find…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>
      <ul className="grid gap-1" data-testid="capability-sources">
        {Object.entries(catalog.sources)
          .filter(([, state]) => state !== "ok")
          .map(([source, state]) => (
            <li key={source} className="text-ink-2 t-small">
              {source}: {state}
            </li>
          ))}
      </ul>
      <table className="w-full text-left t-small">
        <thead>
          <tr>
            <th>key</th>
            <th>kind</th>
            <th>needs</th>
            <th>mutates</th>
            <th>actor</th>
            <th>source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CapabilityRow key={row.key} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CapabilityRow({ row }: { row: Capability }) {
  return (
    <tr title={row.description}>
      <td>
        <code>{row.key}</code>
      </td>
      <td>{row.kind}</td>
      <td>{row.needs}</td>
      <td>{row.mutates ? "yes" : "no"}</td>
      <td>{row.actor}</td>
      <td>{row.source}</td>
    </tr>
  );
}
