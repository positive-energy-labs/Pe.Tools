import type { RouteStatePatch } from "@pe/agent-contracts";

/** One family of trichotomy cells in a route's Work, as the Situation and the Chat head read it. */
export interface Cells<W> {
  /** The Work segment holding the keyed cells; null = one root cell at `key` (`scope`, `launch`). */
  segment: string | null;
  key?: string;
  /** A key's group path; `nouns` names its depths, singular ("parameter", "family"). */
  groupOf: (key: string) => string[];
  nouns?: readonly string[];
  /** The head's subject for these cells; absent = the thread's document. */
  noun?: string;
  show?: (value: unknown) => string;
  /** The head's commit: `open` the route (default), or `plan` there ("apply", one per Work). */
  commit?: "open" | "plan";
  /** Why the head may not write these patches (only the route can), else null. */
  admit?(doc: W, patches: readonly RouteStatePatch[]): { code: string; message: string } | null;
}

/** The cell family the Situation summarizes: the first keyed one. */
export const situationCells = <W>(cells: readonly Cells<W>[] | undefined) =>
  cells?.find((family): family is Cells<W> & { segment: string } => family.segment !== null);
