/**
 * GEOMETRY ROWS — the authored constituents projected into matrix-shaped rows.
 *
 * A geometry row is a VIEW, never a truth: it shows what one constituent field references
 * (`param:Body Width`, or a portable literal) and what that reference resolves to per type.
 * It is therefore READ-ONLY everywhere — the parameter row above, or the register card beside
 * the drawing, is where the authored value is edited.
 *
 * Resolution goes through `#/family/model`, the single resolution path. Nothing here
 * re-implements the trichotomy.
 */
import { paramRef, resolveParam, type FamilyModel } from "#/family/model";

export interface GeometryRow {
  /** Constituent id, shared with the focus vocabulary: `s:` / `c:` / `pl:` / `a:` + slug. */
  id: string;
  /** Row key — one constituent contributes several fields, so the id alone is not unique. */
  key: string;
  /** Constituent name, as the register cards title it. */
  label: string;
  /** Which dimension of the constituent this row is. */
  field: string;
  /** Group heading, mirroring the matrix's `origin` line. */
  origin: string;
  /** The authored reference, verbatim — `param:Body Width` or `6in`. */
  authored: string;
  /** Per-type resolved value. "—" when the reference resolves to nothing. */
  resolve: (typeName: string) => string;
}

/** A raw authored dimension reference — `param:X` or a portable literal — for one type. */
function resolveRef(model: FamilyModel, typeName: string, raw: string): string | null {
  const name = paramRef(raw);
  if (!name) return raw;
  const resolved = resolveParam(model, typeName, name);
  return resolved.source === "missing" ? null : resolved.text;
}

/** Every authored dimension in the model, one row per (constituent, field). */
export function geometryRows(model: FamilyModel): GeometryRow[] {
  const rows: GeometryRow[] = [];
  const push = (
    id: string,
    label: string,
    field: string,
    origin: string,
    authored: string | undefined,
  ) => {
    if (!authored) return;
    rows.push({
      id,
      key: `${id}/${field}`,
      label,
      field,
      origin,
      authored,
      resolve: (typeName) => resolveRef(model, typeName, authored) ?? "—",
    });
  };

  for (const [slug, solid] of Object.entries(model.solids ?? {})) {
    const origin = `solid · ${solid.kind}`;
    push(`s:${slug}`, slug, "width", origin, solid.width);
    push(`s:${slug}`, slug, "depth", origin, solid.depth);
    push(`s:${slug}`, slug, "height", origin, solid.height);
    push(`s:${slug}`, slug, "diameter", origin, solid.diameter);
  }
  for (const [slug, connector] of Object.entries(model.connectors ?? {})) {
    const origin = `connector · ${connector.domain}`;
    push(`c:${slug}`, slug, "Ø", origin, connector.diameter);
    push(`c:${slug}`, slug, "W", origin, connector.width);
    push(`c:${slug}`, slug, "H", origin, connector.height);
    push(`c:${slug}`, slug, "stub depth", origin, connector.stub?.depth);
  }
  for (const [slug, plane] of Object.entries(model.planes ?? {})) {
    push(`pl:${slug}`, slug, `offset ${plane.direction}`, "plane · offset", plane.by);
  }
  for (const [slug, spec] of Object.entries(model.arrays ?? {})) {
    push(`a:${slug}`, slug, "half-count", `array · ${spec.axis}`, spec.halfCount);
  }
  return rows;
}
