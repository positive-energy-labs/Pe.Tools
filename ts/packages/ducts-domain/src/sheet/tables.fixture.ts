import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toGrids, type Grid, type Grids } from "../loss-grid.ts";

// ---- test-only .tbl reader (ctable.py parse), as in kernel/price-leg.test.ts ------------------
function parseTbl(file: string): Record<string, Grid> {
  const text = readFileSync(file, "latin1");
  const out: Record<string, Grid> = {};
  for (const block of text.split(/\r?\n=+\r?\n/)) {
    if (!block.trim() || block.trim().startsWith("'")) continue;
    const lines = block.split(/\r?\n/).filter((l) => l.trim() && !/^[#\s]+$/.test(l));
    const title = lines[0]!.trim();
    const rest = lines.slice(1);
    const head = rest.findIndex((l) => l.includes("->"));
    if (head >= 0) {
      const res = rest.find((l) => /^\s*C\w*\s*$/.test(l))?.trim() ?? "Co";
      const [xLabel, xs] = rest[head]!.split("->");
      const y: number[] = [];
      const grid: number[][] = [];
      for (const l of rest.slice(head + 1).filter((l) => /^\s*[-\d.]/.test(l))) {
        const v = l.trim().split(/\s+/).map(Number);
        y.push(v[0]!);
        grid.push(v.slice(1));
      }
      out[res] = {
        title,
        xLabel: xLabel!.trim(),
        x: xs!.trim().split(/\s+/).map(Number),
        yLabel: rest[head + 1]!.trim(),
        y,
        grid,
      };
    } else {
      const header = rest.find((l) => /\d+\(\d+\)/.test(l))!;
      const x = [...header.matchAll(/(\d+(?:\.\d+)?)\(\d+\)/g)].map((m) => Number(m[1]));
      const co = rest.find((l) => l.trim().startsWith("Co"))!;
      out.Co = { title, xLabel: "D", x, grid: co.trim().split(/\s+/).slice(1).map(Number) };
    }
  }
  return out;
}
const GRID_DIRS = [
  join(__dirname, "../../../../apps/web/src/ducts/fixtures/ashrae"),
  join(__dirname, "../../../../../dotnet/Pe.Shared.Tests/RevitData/Fixtures/Ashrae"),
];
export const grids: Grids = Object.fromEntries(
  GRID_DIRS.filter(existsSync).flatMap((d) =>
    readdirSync(d)
      .filter((f) => f.endsWith(".tbl"))
      .flatMap((f) => {
        try {
          // toGrids refuses what this reader cannot shape: Cr3-10's layout, and the three-axis
          // ER5-1 / ED5-3 / ED5-4 beside the C# fixtures (src/fixtures/converging-tables.json has them).
          const id = f.replace(".tbl", "").toUpperCase();
          return Object.entries(toGrids({ tables: { [id]: parseTbl(join(d, f)) } }));
        } catch {
          return [];
        }
      }),
  ),
);
