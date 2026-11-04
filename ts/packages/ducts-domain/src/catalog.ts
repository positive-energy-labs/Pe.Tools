import type { Immutable } from "../../agent-contracts/src/route-kernel-data.ts";
import { friction, sectionOf } from "./loss-physics.ts";
import type { DuctSnapshot } from "./types.ts";

export {
  catalogSchema,
  catalogTableSchema,
  type CatalogTable,
} from "@pe/agent-contracts";
import { type CatalogTable, type Catalogs as ContractCatalogs, type CatalogInput } from "@pe/agent-contracts";
export type Catalogs = Immutable<ContractCatalogs>;
export const EMPTY_CATALOGS: Catalogs = Object.freeze({});
export const catalogLinkKey = (
  family: string | null | undefined,
  type: string | null | undefined,
) => JSON.stringify([family ?? "", type ?? ""]);
/** The edit link for this family/type, else for the whole family (key with an empty type). */
export const stagedLink = <V>(
  links: Readonly<Record<string, V>>,
  node: { family?: string | null; type?: string | null },
) => links[catalogLinkKey(node.family, node.type)] ?? links[catalogLinkKey(node.family, "")];

type Node = DuctSnapshot["nodes"][number];
type Input = CatalogInput;
export type CatalogFinding =
  | "catalog-missing-link"
  | "catalog-missing-table"
  | "catalog-input"
  | "catalog-out-of-range";
export type CatalogLoss = {
  table?: string;
  source?: CatalogTable["source"];
  notes: string[];
} & (
  | { dp: number; staticInWg: number | null; pv: number; fpm: number }
  | { dp: null; finding: CatalogFinding; error: string }
);

/** No clamping or extrapolation, including the flow limits of an interpolated width row. */
function bracket(xs: readonly number[], x: number): [number, number, number] | null {
  if (!Number.isFinite(x) || x < xs[0]! || x > xs.at(-1)!) return null;
  const hi = xs.findIndex((n) => n >= x);
  if (xs[hi] === x) return [hi, hi, 0];
  return [hi - 1, hi, (x - xs[hi - 1]!) / (xs[hi]! - xs[hi - 1]!)];
}
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

export function catalogLoss(
  node: Node,
  cfm: number | null,
  catalogs: Catalogs,
  links: Readonly<Record<string, { table: string }>> = {},
): CatalogLoss {
  const table =
    stagedLink(links, node)?.table ?? node.facts.find((f) => f.key === "Pe_Catalog")?.text?.trim();
  const t = table && Object.hasOwn(catalogs, table) ? catalogs[table] : undefined;
  const base = {
    ...(table ? { table } : {}),
    ...(t ? { source: t.source } : {}),
    notes: t
      ? [
          `${t.source.title}, ${t.source.edition}; ${t.source.file} p. ${t.source.page} (PDF ${t.source.pdfPage}); ${t.source.url}`,
          t.result.note,
        ]
      : [],
  };
  const bad = (finding: CatalogFinding, error: string): CatalogLoss => ({
    ...base,
    dp: null,
    finding,
    error,
  });
  if (!table)
    return bad(
      "catalog-missing-link",
      "No Pe_Catalog type parameter or edit family/type catalog link",
    );
  if (!t) return bad("catalog-missing-table", `Catalog table ${table} is not loaded`);
  const connectors = node.connectors.filter((c) => c.kind === "end");
  if (connectors.length !== 1 || cfm == null || !Number.isFinite(cfm) || cfm < 0)
    return bad(
      "catalog-input",
      "Catalog needs one end connector and a finite nonnegative design flow",
    );
  const c = connectors[0]!;
  const field = (key: Input["field"]) =>
    key === "flowCfm"
      ? cfm
      : c[key.slice("connector.".length) as "widthIn" | "heightIn" | "diameterIn"];
  const input = (i: Input) => {
    const value = field(i.field);
    const divisor = i.divideBy ? field(i.divideBy.field) : 1;
    return value == null || divisor == null || divisor <= 0
      ? NaN
      : (value * i.scale) / (divisor * (i.divideBy?.scale ?? 1));
  };
  const row = input(t.rows.input!);
  const rb = bracket(t.rows.values, row);
  if (!Number.isFinite(row)) return bad("catalog-input", `Missing input for ${t.rows.quantity}`);
  if (!rb)
    return bad(
      "catalog-out-of-range",
      `${t.rows.quantity} ${row} ${t.rows.unit} outside ${t.rows.values[0]}..${t.rows.values.at(-1)}`,
    );
  const [lo, hi, f] = rb;
  const values = t.columns.values.map((_, j) =>
    lerp(t.cells.values[lo]![j]!, t.cells.values[hi]![j]!, f),
  );
  const x = input((t.result.from === "columns" ? t.cells.input : t.columns.input)!);
  if (!Number.isFinite(x)) return bad("catalog-input", "Missing catalog column/flow input");
  const xs = t.result.from === "columns" ? values : t.columns.values;
  const cb = bracket(xs, x);
  if (!cb)
    return bad(
      "catalog-out-of-range",
      `Catalog input ${x} outside ${xs[0]}..${xs.at(-1)} ${t.result.from === "columns" ? t.cells.unit : t.columns.unit}`,
    );
  const ys = t.result.from === "columns" ? t.columns.values : values;
  const value = lerp(ys[cb[0]]!, ys[cb[1]]!, cb[2]);
  const section = sectionOf(c.shape, c.diameterIn, c.widthIn, c.heightIn);
  if (
    !section ||
    !(section.areaFt2 > 0) ||
    !Number.isFinite(section.areaFt2) ||
    !(section.dhIn > 0)
  )
    return bad("catalog-input", "No connector area for velocity pressure");
  const { fpm, pv } = friction(section, cfm, 0);
  const pressure = value * t.result.toInWg;
  const isReturn =
    (node.classification ?? c.classification ?? "").replaceAll(" ", "") === "ReturnAir";
  const factor =
    isReturn && t.result.quantity === "static-pressure" ? (t.result.returnAir?.factor ?? 1) : 1;
  const staticInWg = t.result.quantity === "static-pressure" ? pressure * factor : null;
  if (factor !== 1)
    base.notes.push(`Return static x ${factor}; ${t.source.file} p. ${t.result.returnAir!.page}`);
  const dp =
    staticInWg == null
      ? t.result.quantity === "coefficient"
        ? value * pv
        : pressure
      : staticInWg + pv;
  if (!Number.isFinite(dp))
    return bad("catalog-input", "Catalog conversion or velocity pressure is not finite");
  return { ...base, staticInWg, pv, fpm, dp };
}
