/**
 * The Write group's review (pressure-drop ledger, 2026-10-20): before a person writes, every change
 * the preview plans reads as one line, element, what changes, old -> new, and every refusal with
 * its reason. The lines are `ducts.apply`'s own preview items (`DuctApplier`), never a web guess;
 * an item that already holds its value is no change and makes no line.
 */
import type { DuctsApply } from "@pe/host-contracts/generated";

import { slotWord } from "./airflow";
import type { PreviewState } from "./inbox-rows";

export interface ReviewLine {
  key: string;
  /** The element's name, or "Pe store" for a slot. */
  element: string;
  /** The parameter, slot or ruling that changes. */
  what: string;
  from: string;
  to: string;
  outcome: string;
  reason: string | null;
}

const WHAT: Record<string, string> = {
  fitting: "loss method",
  terminal: "terminal drop",
  component: "component drop",
  equipment: "ESP",
  "terminal-flow": "airflow",
  "equipment-flow": "unit flow",
  role: "role",
  store: "Pe store",
};

const rulingWord = (key: string) =>
  key.startsWith("proximity:")
    ? "join objection"
    : `${key.slice(0, key.indexOf(":") < 0 ? key.length : key.indexOf(":")).replace(/-/g, " ")} ruling`;

const words = (kind: string, text: string | null | undefined) =>
  text == null ? "none" : kind === "slot" ? slotWord(text) : text;

/** One line per planned, written or refused item of a preview; unchanged items are no change. */
export function reviewLines(
  response: DuctsApply.Res.Response,
  nameOf: (id: number) => string,
): ReviewLine[] {
  return response.writes
    .filter((w) => w.outcome !== "unchanged" && (w.kind !== "store" || w.outcome === "refused"))
    .map((w, i) => ({
      key: `${w.kind}:${w.key ?? w.id ?? ""}:${i}`,
      element:
        w.kind === "slot" || w.kind === "store"
          ? "Pe store"
          : w.id != null
            ? nameOf(w.id)
            : (w.key ?? "—"),
      what:
        w.kind === "slot"
          ? `${w.key} slot`
          : w.kind === "verdict"
            ? rulingWord(w.key ?? "")
            : (WHAT[w.kind] ?? w.kind),
      from: words(w.kind, w.before),
      to: w.outcome === "refused" ? "—" : words(w.kind, w.after),
      outcome: w.outcome,
      reason: w.reason ?? null,
    }));
}

/** A fresh preview as the Write row's popover holds it: the counts and one line per change. */
export function writePreview(
  response: Pick<DuctsApply.Res.Response, "counts">,
  lines: readonly ReviewLine[],
): PreviewState {
  const { planned, refused } = response.counts;
  return {
    word: `previewed ${planned}`,
    summary: `${planned} planned · ${refused} refused`,
    lines: lines.map((line) => ({
      key: line.key,
      text: `${line.element} · ${line.what}${line.outcome === "refused" ? "" : `: ${line.from} → ${line.to}`}`,
      state: line.outcome === "refused" ? "refused" : "planned",
      reason: line.reason,
    })),
  };
}
