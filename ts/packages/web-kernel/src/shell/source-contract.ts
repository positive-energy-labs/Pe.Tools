import type { Effect, ExecutionTarget, WorkKey } from "@pe/agent-contracts";

export interface ReadingScope<P = unknown, W = unknown> {
  target: ExecutionTarget;
  workKey: WorkKey | null;
  workRevision: number | null;
  page: Readonly<P>;
  work: Readonly<W> | null;
  settings?: Readonly<Record<string, unknown>>;
}

export interface ReadingAttempt {
  readonly target: ExecutionTarget;
  readonly workKey: WorkKey | null;
  readonly generation: number;
}

export interface ReadingBasis {
  readonly attempt: ReadingAttempt;
  readonly inputs: Readonly<Record<string, number>>;
  readonly workRevision: number | null;
  readonly algorithmVersion?: string;
  readonly sourceVersion?: string;
}

export interface ReadingState<T = unknown> {
  readonly status: "absent" | "pending" | "partial" | "ready" | "stale" | "failed";
  readonly value?: T;
  readonly previous?: T;
  /** Only a complete, fresh observation can be a mutation basis. */
  readonly current: boolean;
  readonly complete: boolean;
  readonly basis: ReadingBasis | null;
  readonly version: number;
  /**
   * Content hash of `value` (ADR 0028 snapshot groundwork): the source's own version when it
   * declares one, else a hash of the value's canonical JSON. Absent for non-JSON values.
   */
  readonly hash?: string;
  readonly error?: string;
  readonly errorDetails?: string;
}

export type ReadingPublication<T = unknown> =
  | {
      kind: "part" | "complete";
      value: T;
      revision: number;
      sourceVersion?: string;
      fresh?: boolean;
      reason?: string;
    }
  | { kind: "pending" | "stale" }
  | { kind: "failure"; error: unknown }
  | { kind: "log"; value: unknown; id?: string };

export interface ReadingContext extends ReadingScope {
  readonly historyPoint?: string;
  readonly historyPose?: import("@pe/agent-contracts").HistoryPose;
  readonly publication?: { readonly subscription: string; readonly generation: number };
  readonly attempt: ReadingAttempt;
  /** Sources subscribe on demand; an expensive capture starts only for an explicit invocation. */
  readonly trigger: { kind: "demand" } | { kind: "verb"; invocation: string };
  readonly args: unknown;
  readonly inputs: Readonly<Record<string, ReadingState>>;
  readonly signal: AbortSignal;
}

export type ReadingDelivery<T = unknown> = (publication: ReadingPublication<T>) => void;
type Release = () => void;
interface SourcePolicy {
  /** Source-owned input selection, e.g. parameter slots; unrelated Work edits do not reacquire it. */
  key?(scope: ReadingScope): unknown;
  /** Defaults to the attempt's exact document/session. Disk and service sources declare theirs. */
  effects?(context: ReadingContext): readonly Effect[];
  dirties?: readonly string[];
}
export interface UseSource<T = unknown> extends SourcePolicy {
  kind: "use" | "feed";
  open(
    context: ReadingContext,
    deliver: ReadingDelivery<T>,
  ): void | Release | Promise<void | Release>;
}
