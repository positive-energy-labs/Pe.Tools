/**
 * ADR 0028 and ADR 0030 rule 9: the shared value precedence. `run`, then the authored tier: staged
 * `Work`, then `model-store`, the authored value a receipt retired from Work into the model's own store
 * (`_PE_DuctLosses` for ducts). Then observed `model`, the `project` home, the `firm` home, `default` (ADR 0037 rule 8). Null/undefined mean absent;
 * invalid wins and blocks fallback, so a bad stored value never demotes under the raw model or firm.
 */
import type { Author } from "./draft.ts";
import { authorSchema } from "./draft.ts";
import { z } from "zod";
export const VALUE_SOURCES = ["run", "Work", "model-store", "model", "project", "firm", "default"] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];
export interface ValueCell<T> {
  value: T | null | undefined;
  version?: string | number | null;
  ref?: string;
  author: Author | null;
}
export type ValueLayers<T> = Partial<Record<ValueSource, ValueCell<T>>>;
export type ValueResolution<T> =
  | { status: "valid"; value: T; source: ValueSource; author: Author | null;
      ref: string; version: string | number | null; units: string | null }
  | { status: "missing"; value: null; source: "none"; author: null;
      ref: null; version: null; units: string | null }
  | { status: "invalid"; value: null; source: ValueSource; author: Author | null;
      ref: string; version: string | number | null; units: string | null };
export type SourcedValue<T> = ValueResolution<T>;
export type AuthoredValue<T> = Pick<Extract<ValueResolution<T>, { status: "valid" }>, "value" | "source" | "ref" | "version"> & { author: Author };

const ref = z.string().min(1).refine(value => value.trim().length > 0, "evidence identity must be nonempty");
const version = z.union([z.string(), z.number().finite()]).nullable();
const provenance = { source: z.enum(VALUE_SOURCES), author: authorSchema.nullable(), ref, version };
/** Work/run valid values require a known caller; invalid winning layers never become fallback. */
export const valueResolutionSchema = <T extends z.ZodType>(value: T) => z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("valid"), value, ...provenance, units: z.string().nullable() }),
  z.strictObject({ status: z.literal("invalid"), value: z.null(), ...provenance, units: z.string().nullable() }),
  z.strictObject({ status: z.literal("missing"), value: z.null(), source: z.literal("none"), author: z.null(), ref: z.null(), version: z.null(), units: z.string().nullable() }),
]).refine(v => v.status !== "valid" || (v.source !== "Work" && v.source !== "run") || v.author === "human" || v.author === "pea", "valid Work/run values require a known caller");
export const sourcedValueSchema = valueResolutionSchema;
export const authoredValueSchema = <T extends z.ZodType>(value: T) => z.strictObject({
  value, source: z.enum(VALUE_SOURCES), author: authorSchema, ref, version,
}).refine(v => (v.source !== "Work" && v.source !== "run") || v.author !== "unknown", "Work/run offers require a known caller");
export function resolveValue<T>(
  layers: ValueLayers<T>,
  units: string | null = null,
  valid: (value: T) => boolean = (value) => typeof value !== "number" || Number.isFinite(value),
): ValueResolution<T> {
  for (const source of VALUE_SOURCES) {
    const cell = layers[source];
    if (cell?.value == null) continue;
    if (!cell.ref?.trim()) throw new Error("A stated value layer must cite a nonempty evidence ref");
    const accepted = valid(cell.value) && ((source !== "Work" && source !== "run") || cell.author === "human" || cell.author === "pea");
    const evidence = {
      units,
      source,
      version: cell.version ?? null,
      ref: cell.ref,
      author: cell.author ?? null,
    };
    return accepted ? { ...evidence, status: "valid", value: cell.value }
      : { ...evidence, status: "invalid", value: null };
  }
  return { value: null, units, source: "none", version: null, status: "missing", author: null, ref: null };
}
