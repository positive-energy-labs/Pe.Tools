/**
 * Cell-position estimation over coarse OCR bboxes. LlamaParse gives a TABLE
 * one bbox and its content as markdown — no cell geometry. We reconstruct it:
 * parse the md grid, then interpolate cell boxes inside the table bbox
 * (uniform row heights, column widths weighted by content length). Estimates
 * are honest guesses — the UI must present them as such (crosshair + dashed),
 * never as measured truth.
 */
import type { BBox } from "#/lab/mock";

export interface MdGrid {
  header: string[];
  rows: string[][];
}

export function parseMdTable(md: string): MdGrid | null {
  const lines = md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("|"));
  const cellsOf = (line: string) => {
    let l = line;
    if (l.startsWith("|")) l = l.slice(1);
    if (l.endsWith("|")) l = l.slice(0, -1);
    return l.split("|").map((c) => c.trim());
  };
  const isSeparator = (cells: string[]) => cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");
  const parsed = lines.map(cellsOf).filter((cells) => !isSeparator(cells));
  if (parsed.length < 2) return null;
  const [header, ...rows] = parsed;
  return { header, rows };
}

/**
 * A row whose first data cell carries long text and every later cell is empty
 * is a merged/spanning value ("applies to the whole row") — a real edge case
 * in equipment datasheets. It must not count toward column weights.
 */
export function isSpanningRow(row: string[]): boolean {
  return row.length > 2 && !!row[1] && row.slice(2).every((c) => !c) && row[1].length > 30;
}

/**
 * Column x-edges inside the table bbox, weighted by the longest content per
 * column (spanning rows excluded). Calibrated against known geometry:
 * column-center error ≤ ~17pt on 90–130pt columns — right cell, but honest
 * UI must render it as an estimate.
 */
export function columnEdges(grid: MdGrid, bbox: BBox): number[] {
  const nCols = Math.max(grid.header.length, ...grid.rows.map((r) => r.length));
  const weights: number[] = [];
  for (let c = 0; c < nCols; c++) {
    let maxLen = grid.header[c]?.length ?? 0;
    for (const row of grid.rows) {
      if (isSpanningRow(row)) continue;
      maxLen = Math.max(maxLen, row[c]?.length ?? 0);
    }
    // cap: long prose wraps inside its PDF cell, so width doesn't scale with length
    weights.push(Math.max(Math.min(maxLen, 30), 3) + 4); // +4 ≈ cell padding; min keeps empty cols visible
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const edges = [bbox.x];
  let acc = 0;
  for (const w of weights) {
    acc += w;
    edges.push(bbox.x + (acc / total) * bbox.w);
  }
  return edges;
}

/**
 * Estimated bbox for a data cell (rowIdx into grid.rows, colIdx into columns).
 * Assumes one header row and uniform row heights across the bbox.
 */
export function estimateCellBBox(grid: MdGrid, bbox: BBox, rowIdx: number, colIdx: number): BBox {
  const edges = columnEdges(grid, bbox);
  const nBands = grid.rows.length + 1; // header + data rows
  const rowH = bbox.h / nBands;
  return {
    x: edges[colIdx],
    y: bbox.y + (rowIdx + 1) * rowH,
    w: edges[colIdx + 1] - edges[colIdx],
    h: rowH,
  };
}

/* ── Line-box grounding (multi-bbox tables) ────────────────────────────────
   Some LlamaParse tables return MANY bboxes: [0] = table bounds, tall boxes =
   column regions, and ~12pt-tall boxes = per-row TEXT LINE boxes (label +
   value). When line-box rows match the md grid 1:1, cell positions are
   MEASURED, not estimated. */

export function lineBoxGroups(bboxes: BBox[]): BBox[][] {
  if (bboxes.length < 2) return [];
  const table = bboxes[0];
  const lines = bboxes.slice(1).filter((b) => b.h <= 16 && b.h < table.h * 0.5);
  const groups: BBox[][] = [];
  for (const b of [...lines].sort((a, b2) => a.y - b2.y || a.x - b2.x)) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].y - b.y) <= 4) g.push(b);
    else groups.push([b]);
  }
  for (const g of groups) g.sort((a, b2) => a.x - b2.x);
  return groups;
}

/** Line-box group per md data row (index-aligned), or null when they don't line up. */
export function matchRowBoxes(grid: MdGrid, bboxes: BBox[]): (BBox[] | undefined)[] | null {
  const groups = lineBoxGroups(bboxes);
  if (groups.length === 0) return null;
  const n = grid.rows.length;
  const offset = groups.length === n + 1 ? 1 : groups.length === n ? 0 : -1;
  if (offset < 0) return null; // ragged — fall back to interpolation
  return grid.rows.map((_, i) => groups[i + offset]);
}

/* ── Targets from a real parse ─────────────────────────────────────────── */

export interface ParsedDocLike {
  fileName: string;
  pages: { page: number; width: number; height: number; screenshotUrl: string | null }[];
  blocks: { id: string; page: number; kind: string; md: string; bboxes: BBox[] }[];
}

export interface RealTarget {
  key: string;
  blockId: string;
  page: number;
  tableBBox: BBox;
  grid: MdGrid;
  rowIdx: number;
  colIdx: number;
  header: string;
  rowLabel: string;
  value: string;
  cellBBox: BBox; // measured (line box) or estimated (interpolated)
  measured: boolean; // true = cellBBox is a real OCR text box, not an estimate
  multiBBox: boolean; // block had >1 bbox — estimate is shakier
  spanning: boolean; // one value covering the whole row
}

/** Every non-empty data cell of every parsed table becomes a sweep target. */
export function buildTargets(doc: ParsedDocLike): RealTarget[] {
  const targets: RealTarget[] = [];
  for (const block of doc.blocks) {
    if (block.kind !== "table" || block.bboxes.length === 0) continue;
    const grid = parseMdTable(block.md);
    if (!grid) continue;
    const bbox = block.bboxes[0];
    const rowBoxes = matchRowBoxes(grid, block.bboxes);
    grid.rows.forEach((row, rowIdx) => {
      if (isSpanningRow(row)) {
        // one value for the whole row: target the full row band, col 1 → end
        const first = estimateCellBBox(grid, bbox, rowIdx, 1);
        targets.push({
          key: `${block.id}:${rowIdx}:span`,
          blockId: block.id,
          page: block.page,
          tableBBox: bbox,
          grid,
          rowIdx,
          colIdx: 1,
          header: "entire row",
          rowLabel: row[0]?.trim() || `row ${rowIdx + 1}`,
          value: row[1],
          cellBBox: { x: first.x, y: first.y, w: bbox.x + bbox.w - first.x, h: first.h },
          measured: false,
          multiBBox: block.bboxes.length > 1,
          spanning: true,
        });
        return;
      }
      // line boxes ↔ non-empty md cells, both in visual order; 1:1 count = measured cells
      const nonEmpty = row.map((c, i) => (c.trim() ? i : -1)).filter((i) => i >= 0);
      const boxes = rowBoxes?.[rowIdx];
      const rowMeasured = !!boxes && boxes.length === nonEmpty.length;
      row.forEach((value, colIdx) => {
        if (colIdx === 0 || !value.trim()) return; // col 0 = row label; sweep the values
        const box = rowMeasured ? boxes[nonEmpty.indexOf(colIdx)] : undefined;
        targets.push({
          key: `${block.id}:${rowIdx}:${colIdx}`,
          blockId: block.id,
          page: block.page,
          tableBBox: bbox,
          grid,
          rowIdx,
          colIdx,
          header: grid.header[colIdx]?.trim() || `col ${colIdx + 1}`,
          rowLabel: row[0]?.trim() || `row ${rowIdx + 1}`,
          value,
          cellBBox: box
            ? { x: box.x - 3, y: box.y - 3, w: box.w + 6, h: box.h + 6 }
            : estimateCellBBox(grid, bbox, rowIdx, colIdx),
          measured: !!box,
          multiBBox: block.bboxes.length > 1,
          spanning: false,
        });
      });
    });
  }
  return targets;
}
