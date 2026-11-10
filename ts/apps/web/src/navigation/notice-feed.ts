/**
 * The browser's door onto the one notice feed (ADR 0035 rule 7): the host's `notices` Reading,
 * read as `NoticeFeed`. Home Activity, tray Activity, the Mod+Shift+K overlay, the tray card and
 * the OS notification all read it here; none joins threads, receipts and Works itself.
 *
 * Scaffold (slice 6, seam c): until the host serves the feed, the Reading's frames are the old
 * card items and this hook reports nothing usable; `ledger.tsx` still does its own join.
 */
import type { NoticeFeed, NoticeGroup, Reading, ReadingRequest } from "@pe/agent-contracts";
import { noticeRows } from "@pe/agent-contracts";
import { useReading } from "#/host/resource-state";

export const NOTICE_FEED: ReadingRequest = { kind: "notices" };

export function useNoticeFeed(): Reading<NoticeFeed> {
  return useReading<NoticeFeed>(NOTICE_FEED);
}

/** The rows a presentation draws, in feed order; every presentation draws every group. */
export const feedRows = (feed: NoticeFeed | undefined, groups: readonly NoticeGroup[]) =>
  feed ? groups.flatMap((group) => noticeRows(feed, group)) : [];
