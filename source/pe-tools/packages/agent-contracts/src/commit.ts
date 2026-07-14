/**
 * Commit as a first-class primitive.
 *
 * Every trichotomy route's human-only commit command (push/save/apply) is the same
 * fold: take the staged set → refuse if any cell needs review → expand cells into
 * transport edits → run ONE transaction → fold successes into the doc and clear
 * them → keep failures staged for retry → stamp → return a structured result.
 * Four routes hand-rolled this; the substrate now owns it. Routes supply only the
 * domain deltas: how to select, expand, run, and fold.
 */
import type { RouteStateCommandHandler } from "./route-state.ts";
import { resolveTarget } from "./route-state.ts";
import { type TrichotomyCellLike, stagedEntries } from "./trichotomy.ts";

export interface CommitFailure {
  key: string;
  error: string;
}

export interface CommitResult {
  applied: number;
  failures: CommitFailure[];
}

export interface CommitCommandOptions<TDoc, TCell extends TrichotomyCellLike, TEdit> {
  /** The staged set's home — usually `(doc) => doc.cells`. */
  select(doc: TDoc): Record<string, TCell>;
  /**
   * Expand one staged cell into transport edits, or refuse it (`{ error }`) — the
   * refusal becomes a kept-staged failure, not an abort. Tag edits with their cell
   * key if `run` needs to attribute per-edit failures.
   */
  toEdits(key: string, cell: TCell, doc: TDoc): TEdit[] | { error: string };
  /**
   * One transaction over all edits. `target` is already resolved
   * (input.target ?? doc.binding.target). Returns per-key failures; a key absent
   * from the result committed successfully.
   */
  run(edits: TEdit[], doc: TDoc, target: string | undefined): Promise<CommitFailure[]>;
  /** Fold one successfully committed cell into the doc (mutate in place). */
  fold(doc: TDoc, key: string, cell: TCell): void;
  /** Reset one committed cell (mutate in place) — e.g. `doc.cells[key] = { review: "none" }`. */
  clear(doc: TDoc, key: string): void;
  /** Stamp the doc after a commit (mutate in place) — e.g. `doc.pushedAt = isoNow`. */
  stamp?(doc: TDoc, isoNow: string): void;
  /** Optional staleness gate: refuse to commit over a snapshot older than maxAgeMs. */
  freshness?: {
    takenAt(doc: TDoc): string | null | undefined;
    maxAgeMs: number;
    refreshHint: string;
  };
}

export function defineCommitCommand<TDoc, TCell extends TrichotomyCellLike, TEdit>(
  options: CommitCommandOptions<TDoc, TCell, TEdit>,
): RouteStateCommandHandler<TDoc> {
  return async (input, ctx) => {
    const doc = ctx.getDoc();
    const staged = stagedEntries(options.select(doc));
    if (staged.length === 0) return { applied: 0, failures: [] } satisfies CommitResult;

    const attention = staged.filter(([, cell]) => cell.review === "attention");
    if (attention.length > 0) {
      throw new Error(
        `Commit blocked: ${attention.length} staged cell${attention.length === 1 ? "" : "s"} need review.`,
      );
    }

    if (options.freshness) {
      const takenAt = options.freshness.takenAt(doc);
      const age = takenAt ? Date.now() - Date.parse(takenAt) : Number.POSITIVE_INFINITY;
      if (!(age <= options.freshness.maxAgeMs)) {
        throw new Error(`Commit blocked: snapshot is stale. ${options.freshness.refreshHint}`);
      }
    }

    const failures: CommitFailure[] = [];
    const edits: TEdit[] = [];
    for (const [key, cell] of staged) {
      const expanded = options.toEdits(key, cell, doc);
      if (Array.isArray(expanded)) edits.push(...expanded);
      else failures.push({ key, error: expanded.error });
    }

    if (edits.length > 0) {
      failures.push(...(await options.run(edits, doc, resolveTarget(input, doc))));
    }

    const failedKeys = new Set(failures.map((failure) => failure.key));
    let applied = 0;
    for (const [key, cell] of staged) {
      if (failedKeys.has(key)) continue;
      options.fold(doc, key, cell);
      options.clear(doc, key);
      applied += 1;
    }
    options.stamp?.(doc, new Date().toISOString());
    await ctx.setDoc(doc);

    return { applied, failures: dedupeFailures(failures) } satisfies CommitResult;
  };
}

/** Keep the first failure per cell key — a fanned-out cell can report many failed edits. */
export function dedupeFailures(failures: CommitFailure[]): CommitFailure[] {
  const seen = new Set<string>();
  return failures.filter((failure) =>
    seen.has(failure.key) ? false : seen.add(failure.key) && true,
  );
}
