/**
 * Target model — the web-side mirror of the host's `resolveSessionTarget` (apps/host/src/bridge.ts).
 *
 * A Target is a SELECTOR STRING, never a resolved session id. Selectors are stable across
 * process restarts ("user" still means the user's Revit after a restart; a raw sessionId dies
 * with the process), so UI state (URL params, chat session pins) stores selectors and resolves
 * them against the live session list on every render.
 *
 * Resolution is a pure function so every surface (composer chip, route toolbar, plugin,
 * inspector) reflects ONE state, and so the full state space is exercisable in POCs and tests
 * without a live host.
 */

export type SessionLane = "rrd" | "sandbox" | "installed";

/** One Revit process incarnation, as observed by the broker. Projection of bridge session summary. */
export interface SessionFacts {
  sessionId: string;
  processId: number;
  lane: SessionLane;
  sandboxId?: string;
  activeDocumentTitle?: string;
  activeDocumentIsFamilyDocument?: boolean;
  openDocumentCount: number;
  /** activeDocumentObservedAtUnixMs from the bridge snapshot — an observation time, not computed staleness. */
  observedAtUnixMs?: number;
}

/**
 * Selector grammar — must stay in lockstep with host TARGET_SYNTAX (bridge.ts:133).
 * ""             implicit: sole session or nothing
 * "user"         the user's Revit (lane rrd or installed)
 * "rrd"          lane rrd
 * "sandbox:<id>" sandbox by id
 * "<digits>"     pid
 * anything else  raw session id
 */
export type TargetSelector = string;

export type TargetResolution =
  /** Exactly one session matched. mode says HOW: "pinned" = explicit selector, "implicit" = sole session. */
  | {
      kind: "resolved";
      mode: "pinned" | "implicit";
      selector: TargetSelector;
      session: SessionFacts;
    }
  /** More than one candidate — mirror of the host's 409. The UI must refuse to guess, like the host does. */
  | { kind: "ambiguous"; selector: TargetSelector; candidates: SessionFacts[] }
  /** Nothing matched. "no-sessions" = empty world; "no-match" = a pin dangling (its process died). */
  | { kind: "unresolved"; selector: TargetSelector; reason: "no-sessions" | "no-match" };

function matches(session: SessionFacts, selector: TargetSelector): boolean {
  if (selector === "user") return session.lane === "rrd" || session.lane === "installed";
  if (selector === "rrd") return session.lane === "rrd";
  if (selector.startsWith("sandbox:"))
    return session.sandboxId === selector.slice("sandbox:".length);
  if (/^\d+$/.test(selector)) return session.processId === Number(selector);
  return session.sessionId === selector;
}

export function resolveTarget(
  sessions: readonly SessionFacts[],
  selector: TargetSelector,
): TargetResolution {
  if (selector === "") {
    if (sessions.length === 1)
      return { kind: "resolved", mode: "implicit", selector, session: sessions[0]! };
    if (sessions.length === 0) return { kind: "unresolved", selector, reason: "no-sessions" };
    return { kind: "ambiguous", selector, candidates: [...sessions] };
  }
  const hits = sessions.filter((s) => matches(s, selector));
  if (hits.length === 1) return { kind: "resolved", mode: "pinned", selector, session: hits[0]! };
  if (hits.length === 0)
    return {
      kind: "unresolved",
      selector,
      reason: sessions.length === 0 ? "no-sessions" : "no-match",
    };
  return { kind: "ambiguous", selector, candidates: hits };
}

/**
 * Mint the selector a UI writes when the user pins a session. Prefers the most
 * stable selector that is unambiguous in the CURRENT world: sandboxes pin by
 * sandbox id; the user's Revit pins as `user` when it's the only rrd/installed
 * session (survives restarts), else falls back to pid.
 */
export function mintSelector(session: SessionFacts, all: readonly SessionFacts[]): TargetSelector {
  if (session.lane === "sandbox" && session.sandboxId) return `sandbox:${session.sandboxId}`;
  const userLike = all.filter((s) => s.lane === "rrd" || s.lane === "installed");
  if ((session.lane === "rrd" || session.lane === "installed") && userLike.length === 1)
    return "user";
  return String(session.processId);
}

/** Wire entry (bridge.sessions.list) → SessionFacts. Disconnected entries are not targets. */
export function fromBridgeSessions(
  entries: readonly {
    sessionId: string;
    connected: boolean;
    lane?: string | null;
    sandboxId?: string | null;
    processId?: number | null;
    activeDocumentTitle?: string | null;
    openDocumentCount: number;
  }[],
): SessionFacts[] {
  return entries
    .filter((e) => e.connected)
    .map((e) => ({
      sessionId: e.sessionId,
      processId: e.processId ?? 0,
      lane: (e.lane === "rrd" || e.lane === "sandbox" ? e.lane : "installed") as SessionLane,
      sandboxId: e.sandboxId ?? undefined,
      activeDocumentTitle: e.activeDocumentTitle ?? undefined,
      openDocumentCount: e.openDocumentCount,
    }));
}

/** Human label for a session: document first, process as fallback. */
export function sessionLabel(session: SessionFacts): string {
  return session.activeDocumentTitle ?? `Revit ${session.processId}`;
}

/** Short human phrase for a selector (chip text, tooltips). */
export function selectorLabel(selector: TargetSelector): string {
  if (selector === "") return "auto";
  if (selector.startsWith("sandbox:")) return selector; // the id is the meaning
  if (/^\d+$/.test(selector)) return `pid ${selector}`;
  return selector;
}
