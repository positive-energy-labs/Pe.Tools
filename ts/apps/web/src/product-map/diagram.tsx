/**
 * Draws the product map (`@pe/agent-contracts/product-map`): the chain of links, one link's parts
 * as a path, a legend and a parts table. Used by `/map` and by each route's help page. Mermaid
 * loads only when a diagram mounts.
 */
import { useEffect, useRef } from "react";

import {
  PRODUCT_MAP,
  type MapLink,
  type MapPart,
  type MapStatus,
} from "@pe/agent-contracts/product-map";

let renders = 0;

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A fresh id per render: mermaid reuses an existing element by id, and dev mode runs effects twice.
    const id = `product-map-${++renders}`;
    let live = true;
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        look: "classic",
        securityLevel: "strict",
        flowchart: { nodeSpacing: 16, rankSpacing: 22, padding: 6 },
        themeVariables: { fontSize: "13px" },
      });
      const { svg } = await mermaid.render(id, chart);
      if (live && ref.current) ref.current.innerHTML = svg;
    });
    return () => {
      live = false;
    };
  }, [chart]);
  return <div ref={ref} className="my-3 overflow-x-auto" />;
}

const COLORS: Record<MapStatus, { fill: string; stroke: string; label: string }> = {
  works: { fill: "#dcefdc", stroke: "#3a7a3a", label: "works today" },
  gaps: { fill: "#fbefd0", stroke: "#a07a10", label: "works with gaps" },
  none: { fill: "#f6dada", stroke: "#a03a3a", label: "no data yet" },
};

const classes = Object.entries(COLORS)
  .map(([status, c]) => `  classDef ${status} fill:${c.fill},stroke:${c.stroke}`)
  .join("\n");

const node = (id: string, label: string, status: MapStatus) =>
  `  ${id.replace(/[^a-zA-Z0-9]/g, "_")}["${label.replace(/"/g, "'")}"]:::${status}`;
const key = (id: string) => id.replace(/[^a-zA-Z0-9]/g, "_");

/** Every link in chain order. */
export const chainChart = () =>
  [
    "flowchart LR",
    ...PRODUCT_MAP.map((l) => node(l.id, l.label, l.status)),
    ...PRODUCT_MAP.filter((l) => l.after).map((l) => `  ${key(l.after!)} --> ${key(l.id)}`),
    classes,
  ].join("\n");

/** One link's parts on its path, plus the parts its dotted relations name. */
export const pathChart = (link: MapLink) =>
  [
    "flowchart LR",
    ...link.parts
      .filter(
        (p) =>
          link.path.includes(p.id) || link.relations.some((r) => r.from === p.id || r.to === p.id),
      )
      .map((p) => node(p.id, p.label, p.status)),
    `  ${link.path.map(key).join(" --> ")}`,
    ...link.relations.map((r) => `  ${key(r.from)} -. ${r.label} .-> ${key(r.to)}`),
    classes,
  ].join("\n");

export function Legend() {
  return (
    <div className="flex gap-4 t-small">
      {Object.values(COLORS).map((c) => (
        <span key={c.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm border"
            style={{ background: c.fill, borderColor: c.stroke }}
          />
          {c.label}
        </span>
      ))}
    </div>
  );
}

export function PartsTable({ parts }: { parts: readonly MapPart[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse t-small [&_td]:border-t [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top [&_th]:pr-3 [&_th]:text-left">
        <thead>
          <tr>
            <th>Part</th>
            <th>What it adds</th>
            <th>Automatic today?</th>
            <th>Where the data is</th>
            <th>How hard to get</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
            <tr key={p.id}>
              <td>{p.label}</td>
              <td>{p.adds}</td>
              <td>{p.automatic}</td>
              <td>{p.data}</td>
              <td>{p.effort}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
