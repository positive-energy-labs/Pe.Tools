/**
 * The one refusal. Ten symbols across `state/route-store.ts` and `targeting/model.ts` said the
 * same thing in ten shapes. Public boundaries return Refusal; the route runner may use an internal
 * abort to stop an action at a refused mutation, then restores the structured result. Codes are
 * ordered: `no-target` before `not-ready` before `stale-revision`.
 */
import type { FamiliesRefusal, RouteStateWriteResult } from "@pe/agent-contracts";

export type RefusalCode =
  | "not-ready"
  | "no-target"
  | "busy"
  | "stale-revision"
  | "conflict"
  | "partial"
  | "unknown"
  | "failed";

export interface Refusal {
  readonly code: RefusalCode;
  readonly message: string;
  /** Words written for Pea, not the person: drawn only behind a disclosure, never parsed. */
  readonly detail?: string;
  /** The cells it names; each draws the refusal itself, so the verb only tints (a cell-scope refusal). */
  readonly cells?: readonly string[];
}

export const refuse = (code: RefusalCode, message: string, detail?: string): Refusal =>
  detail === undefined ? { code, message } : { code, message, detail };

/** The host's typed write refusal, mapped onto the one vocabulary. */
export function writeRefusal(result: RouteStateWriteResult): Refusal | null {
  if (result.ok) return null;
  if ("agentHint" in result) return refuse("not-ready", doorSentence(result), result.agentHint);
  const message = [result.error, result.hint].filter(Boolean).join(": ");
  if (result.code === "stale_revision") return refuse("stale-revision", message);
  if (result.kind === "refused") return refuse("not-ready", message);
  if (result.kind === "partial") return refuse("partial", message);
  return refuse("failed", message);
}

export const causeRefusal = (cause: unknown): Refusal =>
  refuse("unknown", cause instanceof Error ? cause.message : String(cause));

const names = (families: readonly string[] = []) => families.join(", ");

/**
 * The Families door's refusal in the person's words: one sentence per `code`, built from its
 * structured parts only. `agentHint` is Pea's and is never read here.
 */
function doorSentence(refusal: FamiliesRefusal): string {
  switch (refusal.code) {
    case "unknown-family-type":
      return (refusal.cells ?? [])
        .map(
          (cell) =>
            `${cell.familyName} · ${cell.typeName} · ${cell.parameter}: that family isn't in this page's scope`,
        )
        .join("; ");
    case "unknown-family":
      return `${names(refusal.families)}: not loaded under this scope's categories and placement`;
    case "exclusion-held":
      return `${names(refusal.families)}: you held that back, so only you can change it`;
    case "exclusion-author":
      return `${names(refusal.families)}: that hold-back names the wrong writer`;
    case "no-scope":
      return "Stage a scope first; cells belong to a scope";
    case "scope-truncated":
      return "This scope holds too many families to check; narrow it";
    case "scope-unresolved":
      return "This scope matches no loaded family";
    case "types-truncated":
      return `${names(refusal.families)}: too many types to check`;
    case "document-unavailable":
      return "This page's document isn't open in Revit";
    case "catalog-unreachable":
      return "Revit didn't answer the family check; try again";
  }
}
