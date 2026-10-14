/**
 * When a card item may show, and what a person did with it. The host announces every item; the
 * surface that would show it decides, from what it can see: it stays quiet for the thread the
 * person is looking at, for a revision already acknowledged, and while an item is snoozed. The
 * ledger is that surface's own record (acknowledged revisions, snoozed items), kept across reloads.
 * Nothing here settles a receipt: an acknowledged card leaves every action exactly as it was.
 */
import { z } from "zod";
import { machineNoticeSchema } from "@pe/host-contracts/native-adapter";
import type { MachineNotice } from "@pe/agent-contracts";

export const SNOOZE_MS = 3_600_000;
const KEPT = 200;
const STORAGE_KEY = "pe.notices.ledger";

export interface NoticeView {
  readonly visible: boolean;
  readonly focused: boolean;
  readonly pathname: string;
  readonly thread: string | null;
}
export interface NoticeLedger {
  /** The highest revision of each item the person has seen, dismissed, answered or opened. */
  readonly acked: Readonly<Record<string, number>>;
  readonly snoozed: Readonly<Record<string, { until: number; notice: MachineNotice }>>;
}
export const emptyLedger: NoticeLedger = { acked: {}, snoozed: {} };

export function threadOf(notice: MachineNotice): string | null {
  if (notice.act && "threadId" in notice.act) return notice.act.threadId;
  const link = /^\/pea\?thread=([^&#]+)/.exec(notice.href ?? "");
  return link ? decodeURIComponent(link[1]!) : null;
}

export type Admission = "show" | "looking" | "acknowledged" | "snoozed";
export function admit(
  ledger: NoticeLedger,
  notice: MachineNotice,
  view: NoticeView,
  now: number,
): Admission {
  if ((ledger.acked[notice.id] ?? -1) >= notice.revision) return "acknowledged";
  if ((ledger.snoozed[notice.id]?.until ?? 0) > now) return "snoozed";
  const thread = threadOf(notice);
  return view.visible &&
    view.focused &&
    view.pathname === "/pea" &&
    thread &&
    view.thread === thread
    ? "looking"
    : "show";
}

export function acknowledge(ledger: NoticeLedger, notice: MachineNotice): NoticeLedger {
  const { [notice.id]: _, ...rest } = ledger.acked;
  const acked = { ...rest, [notice.id]: Math.max(notice.revision, ledger.acked[notice.id] ?? 0) };
  const { [notice.id]: __, ...snoozed } = ledger.snoozed;
  return { acked: Object.fromEntries(Object.entries(acked).slice(-KEPT)), snoozed };
}

export function snooze(ledger: NoticeLedger, notice: MachineNotice, now: number): NoticeLedger {
  return {
    ...ledger,
    snoozed: { ...ledger.snoozed, [notice.id]: { until: now + SNOOZE_MS, notice } },
  };
}

/** The snoozed items whose hour is up, and the ledger without them. */
export function wake(ledger: NoticeLedger, now: number) {
  const due = Object.values(ledger.snoozed).filter((s) => s.until <= now);
  if (!due.length) return { ledger, due: [] };
  const snoozed = Object.fromEntries(
    Object.entries(ledger.snoozed).filter(([, s]) => s.until > now),
  );
  return { ledger: { ...ledger, snoozed }, due: due.map((s) => s.notice) };
}

const ledgerSchema = z.object({
  acked: z.record(z.string(), z.number()),
  snoozed: z.record(z.string(), z.object({ until: z.number(), notice: machineNoticeSchema })),
});
type Store = Pick<Storage, "getItem" | "setItem">;

export function loadLedger(storage: Store): NoticeLedger {
  try {
    const parsed = ledgerSchema.safeParse(JSON.parse(storage.getItem(STORAGE_KEY) ?? "null"));
    return parsed.success ? parsed.data : emptyLedger;
  } catch {
    return emptyLedger;
  }
}

export function saveLedger(storage: Store, ledger: NoticeLedger) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  } catch {
    /* Storage can be unavailable or full: the ledger then lasts for this page only. */
  }
}

/** What the person can see right now, read from the page. */
export function currentView(): NoticeView {
  return {
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
    pathname: location.pathname,
    thread: new URLSearchParams(location.search).get("thread"),
  };
}
