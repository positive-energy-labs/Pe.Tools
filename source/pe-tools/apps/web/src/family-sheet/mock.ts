/**
 * Mock data for the /family-sheet UI lane: a fake FCU-400 family snapshot,
 * a pre-parsed spec doc built from the lab's deterministic ACME submittal
 * (FakePage + TableSpec geometry = cell-level grounding with zero network),
 * and a scripted pea proposal batch for demoing the collaborative flow.
 */
import { createElement } from "react";

import {
  type CellProposal,
  type CellReview,
  FORMULA_TYPE,
  type FamilySheetParam,
  type SourceRef,
  type SpecDocBlock,
  type Worksheet,
  worksheetCellKey,
} from "@pe/agent-contracts";

import { FakePage } from "#/lab/kit";
import {
  type BBox,
  PAGE_H,
  PAGE_W,
  T1,
  T2,
  T3,
  T4,
  type TableSpec,
  cellBBox,
  tableH,
} from "#/lab/mock";

/* ── Spec doc: md blocks derived from the lab tables ─────────────────────── */

const DOC_TABLES: { id: string; page: number; t: TableSpec }[] = [
  { id: "p1-perf", page: 1, t: T1 },
  { id: "p2-elec", page: 2, t: T2 },
  { id: "p3-phys", page: 3, t: T3 },
  { id: "p3-sound", page: 3, t: T4 },
];

function tableMd(t: TableSpec): string {
  const header = `| ${t.cols.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${t.cols.map(() => "---").join(" | ")} |`;
  const rows = t.rows.map((r) => `| ${[r.label, ...r.values].join(" | ")} |`);
  return [header, sep, ...rows].join("\n");
}

export const MOCK_DOC_BLOCKS: SpecDocBlock[] = DOC_TABLES.map(({ id, page, t }) => ({
  id,
  page,
  kind: "table",
  md: tableMd(t),
}));

/* ── Grounding: SourceRef (md coordinates) → lab table geometry ──────────── */

export function mockGrounding() {
  return {
    pages: [1, 2, 3].map((page) => ({ page, width: PAGE_W, height: PAGE_H })),
    PageView: ({ page }: { page: number }) => createElement(FakePage, { page: page as 1 | 2 | 3 }),
    targetFor(source: SourceRef): { page: number; bbox: BBox; measured: boolean } | null {
      const entry = DOC_TABLES.find((d) => d.id === source.blockId);
      if (!entry) return null;
      const { t, page } = entry;
      const row = t.rows[source.rowIdx ?? -1];
      if (!row) return { page, bbox: { x: t.x, y: t.y, w: t.w, h: tableH(t) }, measured: false };
      const col = t.cols[source.colIdx ?? -1];
      if (!col) {
        return {
          page,
          bbox: { x: t.x, y: t.y + t.headerH + t.rows.indexOf(row) * t.rowH, w: t.w, h: t.rowH },
          measured: false,
        };
      }
      return { page, bbox: cellBBox(t, row.key, col.key), measured: true };
    },
  };
}

/* ── Family snapshot ─────────────────────────────────────────────────────── */

const TYPES = ["FCU-400-A", "FCU-400-B", "FCU-400-C"];

function param(
  name: string,
  group: string,
  storageType: string,
  values: [string, string, string] | string,
  extra?: Partial<FamilySheetParam>,
): FamilySheetParam {
  const perType = typeof values === "string" ? [values, values, values] : values;
  return {
    name,
    isInstance: false,
    isReadOnly: false,
    isDeterminedByFormula: false,
    isShared: false,
    storageType,
    dataType: null,
    group,
    formula: null,
    valuesPerType: Object.fromEntries(TYPES.map((t, i) => [t, perType[i]])),
    ...extra,
  };
}

export function buildMockWorksheet(): Worksheet {
  const parameters: FamilySheetParam[] = [
    // Dimensions
    param("Width", "Dimensions", "Double", ['24"', '30"', '36"']),
    param("Depth", "Dimensions", "Double", '22"'),
    param("Height", "Dimensions", "Double", '32"', {
      formula: 'Depth + 10"',
      isDeterminedByFormula: true,
      isReadOnly: true,
    }),
    // Mechanical — empty placeholders pea will fill from the spec
    param("Nominal Airflow", "Mechanical", "Double", ["", "", ""]),
    param("Cooling Capacity", "Mechanical", "Double", ["", "", ""]),
    param("External Static Pressure", "Mechanical", "Double", ["", "", ""]),
    param("Water Connection", "Mechanical", "Text", ""),
    // Electrical — stale defaults worth overwriting
    param("Voltage", "Electrical", "Double", "277 V"),
    param("FLA", "Electrical", "Double", ["", "", ""]),
    param("MCA", "Electrical", "Double", ""),
    param("MOCP", "Electrical", "Double", ""),
    param("Motor HP", "Electrical", "Text", ["", "", ""]),
    // Identity
    param("Manufacturer", "Identity Data", "Text", "ACME Air Systems"),
    param("Model", "Identity Data", "Text", ["FCU-400-A", "FCU-400-B", "FCU-400-C"]),
    param("Operating Weight", "Identity Data", "Double", ["", "", ""], { isInstance: true }),
    param("Reference ESP", "Mechanical", "Double", "0.30", { isReadOnly: true }),
  ];

  return {
    snapshot: {
      familyName: "FCU-400.rfa",
      currentTypeName: "FCU-400-A",
      typeNames: TYPES,
      parameters,
      takenAt: "2026-07-06T09:00:00.000Z",
    },
    doc: {
      parseId: "mock",
      fileName: "acme-fcu400-submittal.pdf",
      blocks: MOCK_DOC_BLOCKS,
    },
    cells: {
      // one already-accepted + reviewed-good cell
      [worksheetCellKey("Nominal Airflow", "FCU-400-A")]: {
        proposal: peaCell("400 CFM", "p1-perf", 0, 1, "high"),
        staged: "400 CFM",
        review: "good",
      },
      // one open proposal
      [worksheetCellKey("Cooling Capacity", "FCU-400-A")]: {
        proposal: peaCell("12.0 MBH", "p1-perf", 1, 1, "high"),
        review: "none",
      },
      // the wrinkle: pea flagged its own low-confidence read (doc says 208 V for model C)
      [worksheetCellKey("Voltage", "FCU-400-C")]: {
        proposal: peaCell(
          "115 V",
          "p1-perf",
          2,
          3,
          "low",
          "Doc column may be misread — verify against source.",
        ),
        review: "attention",
      },
    },
    pushedAt: null,
  };
}

function peaCell(
  value: string,
  blockId: string,
  rowIdx: number,
  colIdx: number,
  confidence: "high" | "low",
  note?: string,
): CellProposal {
  return { value, by: "pea", source: { blockId, rowIdx, colIdx }, confidence, note: note ?? null };
}

/* ── Scripted pea batch (simulatePea) ────────────────────────────────────── */

interface MockPeaEntry {
  paramName: string;
  typeName: string;
  proposal: CellProposal;
  review?: CellReview;
}

const MODEL_COLS: [string, number][] = TYPES.map((t, i) => [t, i + 1]);

export const MOCK_PEA_BATCH: MockPeaEntry[] = [
  ...MODEL_COLS.map(([typeName, colIdx]) => ({
    paramName: "Cooling Capacity",
    typeName,
    proposal: peaCell(T1.rows[1].values[colIdx - 1], "p1-perf", 1, colIdx, "high" as const),
  })),
  ...MODEL_COLS.map(([typeName, colIdx]) => ({
    paramName: "FLA",
    typeName,
    proposal: peaCell(T1.rows[3].values[colIdx - 1], "p1-perf", 3, colIdx, "high" as const),
  })),
  // single-value table rows apply to every type — same source, three cells
  ...TYPES.map((typeName) => ({
    paramName: "MCA",
    typeName,
    proposal: peaCell(
      "3.0 A",
      "p2-elec",
      3,
      1,
      "high" as const,
      "Single value — applies to all models.",
    ),
  })),
  ...TYPES.map((typeName) => ({
    paramName: "MOCP",
    typeName,
    proposal: peaCell(
      "15 A",
      "p2-elec",
      4,
      1,
      "high" as const,
      "Single value — applies to all models.",
    ),
  })),
  // transposed table (models on y-axis)
  ...TYPES.map((typeName, i) => ({
    paramName: "Operating Weight",
    typeName,
    proposal: peaCell(T3.rows[i].values[2], "p3-phys", i, 3, "high" as const),
  })),
  ...TYPES.map((typeName, i) => ({
    paramName: "Motor HP",
    typeName,
    proposal: peaCell(T3.rows[i].values[1], "p3-phys", i, 2, "high" as const),
  })),
  // a formula proposal (no doc source — pea inferred it)
  {
    paramName: "Height",
    typeName: FORMULA_TYPE,
    proposal: {
      value: 'Depth + 12"',
      by: "pea",
      source: null,
      confidence: "low",
      note: 'Datasheet cabinet height implies +12" over depth; current formula says +10".',
    },
    review: "attention",
  },
];
