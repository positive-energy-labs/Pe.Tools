/**
 * The open-work ledger: three presentations (Home's column, the Ctrl+Shift+K overlay, the tray
 * Activity) of the host's one notice feed (`NoticeRow`, ADR 0035 rule 7). The host owns the rows
 * and their words; this owns how each presentation draws them. Waits and working lead every
 * presentation and never fold (owner, 2026-10-13).
 */
import type { NoticeGroup, NoticeRow } from "@pe/agent-contracts";

export const GROUP_NAME: Record<NoticeGroup, string> = {
  waits: "waits on you",
  working: "working",
  interrupted: "interrupted",
  failed: "failed",
  unread: "unread",
};

export interface LedgerPresentation {
  id: "home" | "overlay" | "tray";
  label: string;
  /** The group counter strip on top. */
  counters: boolean;
  /** Tools, Works and threads join the rows while a query is typed. */
  destinations: boolean;
  /** Draw the row's sentence under it. */
  says: boolean;
}

export const LEDGER_PRESENTATIONS: Record<LedgerPresentation["id"], LedgerPresentation> = {
  home: {
    id: "home",
    label: "Activity",
    counters: false,
    destinations: false,
    says: true,
  },
  overlay: {
    id: "overlay",
    label: "Find open work, tools, Works and Pea threads",
    counters: false,
    destinations: true,
    says: false,
  },
  tray: {
    id: "tray",
    label: "Activity",
    counters: true,
    destinations: false,
    says: true,
  },
};

export type LedgerItem =
  | { kind: "row"; key: string; row: NoticeRow }
  /** An explicit empty leading group; it never stands in for hidden rows. */
  | { kind: "note"; key: string; group: NoticeGroup; count: 0; text: string };
