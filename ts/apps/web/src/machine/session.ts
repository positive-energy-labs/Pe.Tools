/**
 * One SDK census row, read the way every machine surface speaks of it. Custody and phase are the
 * SDK's (`row.case`, the bridge observation); nothing here infers either, and nothing reads the
 * host bridge socket as a phase (connected-or-not left product chrome, host ledger 2026-10-09).
 */
import type { MachineSession } from "@pe/agent-contracts";
import type { ProcessIdentity, SessionObservation } from "@pe/host-contracts/pe-revit-contract";

export type Phase = "ready" | "booting" | "no add-in" | "unresponsive" | "gone" | "failed";

export const PHASE_TONE: Record<Phase, "caution" | "alarm" | undefined> = {
  ready: undefined,
  booting: undefined,
  "no add-in": "caution",
  unresponsive: "caution",
  gone: undefined,
  failed: "alarm",
};

export function processOf(row: SessionObservation): ProcessIdentity | null {
  switch (row.case) {
    case "controlled-active":
    case "observed-active":
    case "gone-receipt":
      return row.process;
    case "controlled-pending":
      return row.attempt.attempt === "launched" ? row.attempt.process : null;
    case "failed-receipt":
      return row.failure.source === "journal" ? row.failure.process : null;
  }
}

export const pidOf = (row: SessionObservation) => processOf(row)?.pid ?? null;

export const custodyOf = (row: SessionObservation) =>
  row.case === "observed-active" ? ("observed" as const) : ("controlled" as const);

export function phaseOf(row: SessionObservation): Phase {
  switch (row.case) {
    case "controlled-active":
      return row.bridge.bridge === "ready" && !row.bridge.unresponsive ? "ready" : "unresponsive";
    case "controlled-pending":
      return "booting";
    case "observed-active":
      return row.bridge.bridge === "answering"
        ? "ready"
        : row.bridge.bridge === "missing-endpoint"
          ? "no add-in"
          : "unresponsive";
    case "gone-receipt":
      return "gone";
    case "failed-receipt":
      return "failed";
  }
}

/** The SDK selection a verb sends: an icon-started Revit has no name, so its pid. */
export const selectionOf = (row: SessionObservation): { pid: number } | { id: string } =>
  row.case === "observed-active" ? { pid: row.process.pid } : { id: row.id };

export const selectorWords = (row: SessionObservation) =>
  row.case === "observed-active" ? `--pid ${row.process.pid}` : `--id ${row.id}`;

/** A stable React key and launcher target for one Revit incarnation. */
export const keyOf = (session: MachineSession) =>
  session.row.case === "observed-active" ? `pid:${session.row.process.pid}` : session.row.id;

export const nameOf = (row: SessionObservation) =>
  row.case === "observed-active" ? "started from the Revit icon" : row.id;

export const unsavedOf = (session: MachineSession) =>
  (session.documents ?? []).filter((document) => document.isModified);
