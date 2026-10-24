import { useEffect, useRef } from "react";
import { Table } from "@pe/kit/table/table";
import type { Column } from "@pe/kit/table/model";
import { Deferred } from "@pe/kit/lang/section";
import {
  PRODUCT_MAP,
  type MapLink,
  type MapPart,
  type MapStatus,
} from "@pe/agent-contracts/product-map";
let renders = 0;
export function Mermaid({ chart }: { chart: string }) {
  return (
    <Deferred>
      <MermaidDrawing chart={chart} />
    </Deferred>
  );
}
function MermaidDrawing({ chart }: { chart: string }) {
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
export const chainChart = () =>
  [
    "flowchart LR",
    ...PRODUCT_MAP.map((l) => node(l.id, l.label, l.status)),
    ...PRODUCT_MAP.filter((l) => l.after).map((l) => `  ${key(l.after!)} --> ${key(l.id)}`),
    classes,
  ].join("\n");
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
const PART_COLUMNS: readonly Column<MapPart>[] = (
  [
    ["label", "Part"],
    ["adds", "What it adds"],
    ["automatic", "Automatic today?"],
    ["data", "Where the data is"],
    ["effort", "How hard to get"],
  ] as const
).map(([key, label]) => ({
  key,
  label,
  cell: (part) => <div className="px-2 py-1.5 whitespace-normal">{part[key]}</div>,
}));
export function PartsTable({ parts }: { parts: readonly MapPart[] }) {
  return (
    <Deferred>
      <Table
        rows={parts}
        columns={PART_COLUMNS}
        rowKey={(part) => part.id}
        label="Product map parts"
        maxHeight="none"
      />
    </Deferred>
  );
}
