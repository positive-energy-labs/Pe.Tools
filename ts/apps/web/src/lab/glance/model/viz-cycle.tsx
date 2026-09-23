import { token } from "#/lib/token";
import type { ReactNode } from "react";
import { type CoverageSegment } from "#/components/lang/coverage-bar";
import { type VizIndex } from "#/ops/primitives";

const VIZ_CYCLE: VizIndex[] = [1, 2, 3, 4, 5, 6];

export function categoryViz(name: string, index: number): VizIndex {
  const n = name.toLowerCase();
  if (/mechanical|duct|air|hvac|flex/.test(n)) return 2;
  if (
    /electrical|lighting|conduit|cable|wire|power|data|communication|fire|security|nurse|telephone|switch/.test(
      n,
    )
  )
    return 5;
  if (/plumbing|pipe|sprinkler/.test(n)) return 1;
  if (/annotation|tag|detail|title|text|symbol/.test(n)) return 3;
  return VIZ_CYCLE[index % VIZ_CYCLE.length] ?? 4;
}

export function composition(
  rows: { name: string; count: number }[],
  topN: number,
): CoverageSegment[] {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN).reduce((acc, row) => acc + row.count, 0);
  const segments: CoverageSegment[] = top.map((row, i) => ({
    label: row.name,
    count: row.count,
    viz: categoryViz(row.name, i),
  }));
  if (rest > 0) segments.push({ label: `other ×${sorted.length - topN}`, count: rest, viz: 3 });
  return segments;
}

export function obs(observedAtUtc: string | undefined, fallbackMs: number): string {
  if (observedAtUtc) return new Date(observedAtUtc).toLocaleTimeString();
  return fallbackMs ? new Date(fallbackMs).toLocaleTimeString() : "—";
}

export function MonoAside({ children }: { children: ReactNode }) {
  return <span className="">{children}</span>;
}

export function Stat({
  label,
  value,
  warn,
  warnTitle,
}: {
  label: string;
  value: ReactNode;
  warn?: boolean;
  warnTitle?: string;
}) {
  return (
    <div className="min-w-[64px] px-3 py-1.5" title={warn ? warnTitle : undefined}>
      <div className="" style={warn ? { color: token("caution") } : undefined}>
        {value ?? "∅"}
      </div>
      <div className="">{label}</div>
    </div>
  );
}

export const SERIES_META: Record<string, { label: string; viz: VizIndex }> = {
  M: { label: "mechanical", viz: 2 },
  E: { label: "electrical", viz: 5 },
  P: { label: "plumbing", viz: 1 },
  G: { label: "general", viz: 3 },
};
