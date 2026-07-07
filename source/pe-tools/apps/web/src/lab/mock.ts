/**
 * Deterministic ACME datasheet geometry (612×792 page coords) behind the
 * /family-sheet `?mock` demo: FakePage renders these tables, and the same
 * TableSpec coordinates give the mock grounding cell-level source bboxes
 * with no parser in the loop.
 */

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PAGE_W = 612;
export const PAGE_H = 792;

export interface TableSpec {
  x: number;
  y: number;
  w: number;
  headerH: number;
  rowH: number;
  cols: { key: string; label: string; w: number }[];
  rows: { key: string; label: string; values: string[] }[];
}

/** Page 1 performance table — one column per model. */
export const T1: TableSpec = {
  x: 48,
  y: 180,
  w: 516,
  headerH: 30,
  rowH: 30,
  cols: [
    { key: "param", label: "Parameter", w: 180 },
    { key: "A", label: "FCU-400-A", w: 112 },
    { key: "B", label: "FCU-400-B", w: 112 },
    { key: "C", label: "FCU-400-C", w: 112 },
  ],
  rows: [
    { key: "airflow", label: "Nominal Airflow", values: ["400 CFM", "600 CFM", "800 CFM"] },
    { key: "cooling", label: "Cooling Capacity", values: ["12.0 MBH", "18.5 MBH", "24.0 MBH"] },
    { key: "voltage", label: "Voltage", values: ["115 V", "115 V", "208 V"] },
    { key: "fla", label: "FLA", values: ["1.2 A", "1.8 A", "2.4 A"] },
    { key: "width", label: "Width", values: ['24"', '30"', '36"'] },
  ],
};

/** Page 2 electrical table — single value column (applies to all models). */
export const T2: TableSpec = {
  x: 48,
  y: 90,
  w: 300,
  headerH: 26,
  rowH: 26,
  cols: [
    { key: "prop", label: "Property", w: 170 },
    { key: "val", label: "Value", w: 130 },
  ],
  rows: [
    { key: "supply", label: "Supply Connection", values: ['3/4" NPT'] },
    { key: "return", label: "Return Connection", values: ['3/4" NPT'] },
    { key: "condensate", label: "Condensate", values: ['7/8" OD'] },
    { key: "mca", label: "MCA", values: ["3.0 A"] },
    { key: "mocp", label: "MOCP", values: ["15 A"] },
  ],
};

/** Page 3 TRANSPOSED table — models on the y-axis (a real-world edge case). */
export const T3: TableSpec = {
  x: 48,
  y: 120,
  w: 516,
  headerH: 28,
  rowH: 28,
  cols: [
    { key: "model", label: "Model", w: 120 },
    { key: "esp", label: "ESP (in. wg)", w: 99 },
    { key: "hp", label: "Motor HP", w: 99 },
    { key: "weight", label: "Op. Weight", w: 99 },
    { key: "conn", label: "Water Conn.", w: 99 },
  ],
  rows: [
    { key: "A", label: "FCU-400-A", values: ["0.30", "1/6", "92 lb", '3/4"'] },
    { key: "B", label: "FCU-400-B", values: ["0.50", "1/4", "110 lb", '3/4"'] },
    { key: "C", label: "FCU-400-C", values: ["0.50", "1/3", "128 lb", '1"'] },
  ],
};

/** Page 3 sound table — carries a row-spanning "one value for the whole row" footer. */
export const T4: TableSpec = {
  x: 48,
  y: 300,
  w: 516,
  headerH: 26,
  rowH: 26,
  cols: [
    { key: "band", label: "Octave band", w: 156 },
    { key: "b125", label: "125 Hz", w: 90 },
    { key: "b250", label: "250 Hz", w: 90 },
    { key: "b500", label: "500 Hz", w: 90 },
    { key: "b1k", label: "1 kHz", w: 90 },
  ],
  rows: [{ key: "lw", label: "Sound power (Lw)", values: ["52", "48", "45", "41"] }],
};

export function tableH(t: TableSpec): number {
  return t.headerH + t.rows.length * t.rowH;
}

export function cellBBox(t: TableSpec, rowKey: string, colKey: string): BBox {
  const ri = t.rows.findIndex((r) => r.key === rowKey);
  const ci = t.cols.findIndex((c) => c.key === colKey);
  const x = t.x + t.cols.slice(0, ci).reduce((a, c) => a + c.w, 0);
  return { x, y: t.y + t.headerH + ri * t.rowH, w: t.cols[ci].w, h: t.rowH };
}
