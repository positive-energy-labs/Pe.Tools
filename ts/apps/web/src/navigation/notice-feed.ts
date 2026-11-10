/**
 * The browser's door onto the one notice feed (ADR 0035 rule 7): the host's `notices` Reading,
 * read as `NoticeFeed`. Home Activity, tray Activity and the Mod+Shift+K overlay draw it here;
 * the tray card and the OS notification follow it in `machine/notice-follow.ts`. None joins
 * threads, receipts and Works itself.
 */
import type { NoticeFeed, NoticeGroup, Reading, ReadingRequest } from "@pe/agent-contracts";
import { consentWindows, noticeRows } from "@pe/agent-contracts";
import type { ConsentWindow } from "@pe/kit/lang/consent-sweep";
import { useReading } from "#/host/resource-state";

export const NOTICE_FEED: ReadingRequest = { kind: "notices" };

export function useNoticeFeed(): Reading<NoticeFeed> {
  return useReading<NoticeFeed>(NOTICE_FEED);
}

/** The rows a presentation draws, in feed order; every presentation draws every group. */
export const feedRows = (feed: NoticeFeed | undefined, groups: readonly NoticeGroup[]) =>
  feed ? groups.flatMap((group) => noticeRows(feed, group)) : [];

/** The feed's open consent windows as the sweep draws them: the thread's title and the tool's. */
export const sweepWindows = (feed: NoticeFeed | undefined): ConsentWindow[] =>
  feed
    ? consentWindows(feed).map(({ row, act }) => ({
        requestId: act.requestId,
        threadId: act.threadId,
        thread: row.what,
        verb: row.says ?? "Pea writes",
        ...(act.deadline ? { deadline: act.deadline } : {}),
        reject: act.reject ?? null,
        ...(act.allow ? { allow: act.allow } : {}),
      }))
    : [];
