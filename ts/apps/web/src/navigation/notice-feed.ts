/**
 * The browser's door onto the one notice feed (ADR 0035 rule 7): the host's `notices` Reading,
 * read as `NoticeFeed`. Home Activity, tray Activity and the Mod+Shift+K overlay draw it here;
 * the tray card and the OS notification follow it in `machine/notice-follow.ts`. None joins
 * threads, receipts and Works itself.
 */
import type { NoticeFeed, NoticeGroup, Reading, ReadingRequest } from "@pe/agent-contracts";
import { NOTICE_GROUPS, noticeRows } from "@pe/agent-contracts";
import { pushes } from "#/machine/notice-follow";
import { GROUP_NAME } from "./ledger-model";
import { useReading } from "#/host/resource-state";

const NOTICE_FEED: ReadingRequest = { kind: "notices" };

export function useNoticeFeed(): Reading<NoticeFeed> {
  return useReading<NoticeFeed>(NOTICE_FEED);
}

/**
 * The top bar's count: the rows that ask for a person, by the rule that raises a card (`pushes`),
 * so the count and the card never disagree. Null when nothing asks: the bar then draws no count,
 * and the overlay it opens says "Nothing open" in its own words.
 */
export const openNotices = (feed: NoticeFeed | undefined) => {
  const rows = feed?.rows.filter(pushes) ?? [];
  if (!rows.length) return null;
  const groups = NOTICE_GROUPS.flatMap((group) => {
    const count = rows.filter((row) => row.group === group).length;
    return count ? [`${count} ${GROUP_NAME[group]}`] : [];
  });
  return { count: rows.length, says: groups.join(", ") };
};

/** The rows a presentation draws, in feed order; every presentation draws every group. */
export const feedRows = (feed: NoticeFeed | undefined, groups: readonly NoticeGroup[]) =>
  feed ? groups.flatMap((group) => noticeRows(feed, group)) : [];
