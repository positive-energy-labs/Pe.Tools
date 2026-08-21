import type { ComponentType } from "react";

import { OutcomeLine } from "#/components/lang/outcome";

/**
 * Curated readonly views per op key. The generic playground renders whatever
 * the live catalog lists; a registered view replaces the auto-projection with a
 * surface shaped like the Revit thing the op reflects.
 */

/**
 * A view refusing to render data it cannot narrow. Not an empty state — rows may well
 * exist — and not the model disagreeing, so it wears `error` (caution), never alarm.
 * The raw-response disclosure below every result is the exit.
 */
export function UnrecognizedShape() {
  return (
    <OutcomeLine
      kind="error"
      label="unrecognized response shape"
      says="this curated view cannot narrow the payload — see the raw response below"
    />
  );
}

export type OpViewProps = {
  /** The op's validated response object. Views narrow defensively — never crash. */
  data: unknown;
  opKey: string;
  request: unknown;
};

export type OpViewRegistry = Record<string, ComponentType<OpViewProps>>;

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  return asArray(value).flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value as string | number | boolean);
}
