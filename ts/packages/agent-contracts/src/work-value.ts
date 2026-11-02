/** ADR 0028: the shared Work value precedence. Null/undefined mean absent; invalid wins and blocks fallback. */
export const VALUE_SOURCES = ["run", "Work", "model", "firm", "default"] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];
export interface ValueCell<T> {
  value: T | null | undefined;
  version?: string | number | null;
  ref?: string;
}
export type ValueLayers<T> = Partial<Record<ValueSource, ValueCell<T>>>;
export interface ValueResolution<T> {
  value: T | null;
  units: string | null;
  source: ValueSource | "none";
  version: string | number | null;
  status: "valid" | "missing" | "invalid";
  ref?: string;
}
export function resolveValue<T>(
  layers: ValueLayers<T>,
  units: string | null = null,
  valid: (value: T) => boolean = (value) => typeof value !== "number" || Number.isFinite(value),
): ValueResolution<T> {
  for (const source of VALUE_SOURCES) {
    const cell = layers[source];
    if (cell?.value == null) continue;
    const accepted = valid(cell.value);
    return {
      value: accepted ? cell.value : null,
      units,
      source,
      version: cell.version ?? null,
      status: accepted ? "valid" : "invalid",
      ...(cell.ref == null ? {} : { ref: cell.ref }),
    };
  }
  return { value: null, units, source: "none", version: null, status: "missing" };
}
