/**
 * The one refusal. Ten symbols across `state/route-store.ts` and `targeting/model.ts` said the
 * same thing in ten shapes. Public boundaries return Refusal; the route runner may use an internal
 * abort to stop an action at a refused mutation, then restores the structured result. Codes are
 * ordered: `no-target` before `not-ready` before `stale-revision`.
 */
import type { RouteStateWriteResult } from "@pe/agent-contracts";

export type RefusalCode =
  | "not-ready"
  | "no-target"
  | "busy"
  | "stale-revision"
  | "conflict"
  | "duplicate"
  | "partial"
  | "unknown"
  | "failed";

export interface Refusal {
  readonly code: RefusalCode;
  readonly message: string;
}

export const refuse = (code: RefusalCode, message: string): Refusal => ({ code, message });

/** The order a caller must test in: the first reason that applies is the one it says. */
export const REFUSAL_ORDER: readonly RefusalCode[] = [
  "no-target",
  "not-ready",
  "stale-revision",
  "busy",
  "conflict",
  "duplicate",
  "partial",
  "failed",
  "unknown",
];

export const firstRefusal = (candidates: readonly (Refusal | null)[]): Refusal | null =>
  candidates
    .filter((value): value is Refusal => value !== null)
    .sort((a, b) => REFUSAL_ORDER.indexOf(a.code) - REFUSAL_ORDER.indexOf(b.code))[0] ?? null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A command result may report per-item failures beside an overall ok: that is `partial`. */
export function partialRefusal(result: { result?: unknown }, noun: string): Refusal | null {
  const failures = isRecord(result.result) ? result.result.failures : undefined;
  if (!Array.isArray(failures) || failures.length === 0) return null;
  const first = failures[0] as { key?: string; error?: string };
  const detail = [first?.key, first?.error].filter((part) => typeof part === "string").join(": ");
  return refuse(
    "partial",
    `${failures.length} ${noun}${failures.length === 1 ? "" : "s"} failed${detail ? `: ${detail}` : "."}`,
  );
}

/** The host's typed write refusal, mapped onto the one vocabulary. */
export function writeRefusal(result: RouteStateWriteResult): Refusal | null {
  if (result.ok) return null;
  const message = [result.error, result.hint].filter(Boolean).join(": ");
  if (result.code === "stale_revision") return refuse("stale-revision", message);
  // The host saw this request id on a different gesture: the retry is not the write it replays.
  if (result.code === "request_id_conflict") return refuse("duplicate", message);
  // The receipt is gone, so the original outcome cannot be recovered either way.
  if (result.code === "replay_unavailable") return refuse("unknown", message);
  if (result.kind === "refused") return refuse("not-ready", message);
  if (result.kind === "partial") return refuse("partial", message);
  return refuse("failed", message);
}

export const causeRefusal = (cause: unknown): Refusal =>
  refuse("unknown", cause instanceof Error ? cause.message : String(cause));
