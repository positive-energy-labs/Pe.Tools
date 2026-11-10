/**
 * The one notice feed (ADR 0035 rule 7): the host's `notices` Reading serves a `NoticeFeed`, every
 * row that needs a person or tells one what happened, grouped waits, working, interrupted, failed,
 * unread. It replaces two projections: the card feed in `notices.ts` (push) and the browser join in
 * `apps/web/src/navigation/ledger.tsx` (pull). Sources, all host-owned: thread summaries and each
 * waiting thread's open ask, receipts, Works with staged edits, and machine attention lines.
 *
 * Scaffold (slice 6, seam c): the deps are the contract; `observe` is the gap.
 */
import type { NoticeFeed, ReadingFrame, ReadingRequest } from "@pe/agent-contracts";

export interface NoticeFeedDeps {
  /** The current feed, built from the host's own stores; called once per source change. */
  readonly build: () => NoticeFeed;
  /** Fires whenever any source moved; the feed is rebuilt and published once per change. */
  readonly subscribe: (changed: () => void) => () => void;
}

export interface NoticeFeedReading {
  /** Serves `{ kind: "notices" }`; any other request is not this Reading's (undefined). */
  observe(
    request: ReadingRequest,
    publish: (frame: ReadingFrame) => void,
    after?: number | null,
  ): (() => void) | undefined;
  close(): void;
}

export function createNoticeFeed(_deps: NoticeFeedDeps): NoticeFeedReading {
  throw new Error(
    "kernel gap: the host does not serve the notice feed yet (ADR 0035 rule 7, slice 6 seam c)",
  );
}
