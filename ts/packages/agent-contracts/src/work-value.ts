/**
 * ADR 0028 and ADR 0030 rule 9: the shared value precedence. `run`, then the authored tier: staged
 * `Work`, then `model-store`, the authored value a receipt retired from Work into the model's own store
 * (`_PE_DuctLosses` for ducts). Then observed `model`, `firm`, `default`. Null/undefined mean absent;
 * invalid wins and blocks fallback, so a bad stored value never demotes under the raw model or firm.
 */
export const VALUE_SOURCES = ["run", "Work", "model-store", "model", "firm", "default"] as const;
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
