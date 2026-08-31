/**
 * Target model — the web-side view of the host's `resolveSessionTarget` (apps/host/src/bridge.ts).
 *
 * This file used to carry its own `SessionLane` union and its own selector grammar, hand-synced to
 * the host's. Both are gone: `Custody` and `Lane` come from `@pe/host-contracts/contracts`
 * (bridge-protocol.ts), the one home for that vocabulary since SDK beta.131 dropped the unions
 * from its generated contract.
 *
 * A Target is a SELECTOR STRING, never a resolved session id. Selectors are stable across process
 * restarts (`observed` still means the session pe-revit holds no receipt for after a restart; a raw
 * bridge session id dies with the process), so UI state (URL params, chat session pins) stores
 * selectors and resolves them against the live session list on every render.
 *
 * Resolution is a pure function so every surface (composer chip, route toolbar, plugin, inspector)
 * reflects ONE state, and so the full state space is exercisable in POCs and tests without a live
 * host.
 */

import type { Custody, Lane } from "@pe/host-contracts/contracts";
import { addressSchema, type Address } from "@pe/agent-contracts";

export type { Custody, Lane };

/** One Revit process incarnation, as observed by the broker. Projection of bridge session summary. */
export interface SessionFacts {
  /** The BROKER's id: hash(pid + processStartUtc). Not the pe-revit session id. */
  sessionId: string;
  processId: number;
  /** Payload SOURCE, the SDK's only two values. Null when the payload reported none. */
  lane: Lane | null;
  /** The id `pe-revit session list` prints, when this payload was launched by pe-revit. */
  sdkSessionId?: string;
  /**
   * `controlled` = pe-revit holds a receipt (full lifecycle); `observed` = it does not (reads
   * only). Disclosed by the broker. The UI must NOT re-implement the refusal — the SDK resolver
   * already refuses every mutation on `observed`, and a second guard here can only disagree.
   */
  custody: Custody;
  activeDocumentId?: string;
  activeDocumentTitle?: string;
  openDocumentCount: number;
  /** activeDocumentObservedAtUnixMs from the bridge snapshot — an observation time, not computed staleness. */
  observedAtUnixMs?: number;
}

/**
 * Selector grammar — the host's `TARGET_SYNTAX`, in the SDK's words.
 * ""              implicit: sole session or nothing
 * "controlled"    custody controlled (pe-revit launched it)
 * "observed"      custody observed (no pe-revit receipt — the user's own Revit)
 * "dev"           lane dev
 * "installed"     lane installed
 * "session:<id>"  by pe-revit session id
 * "<digits>"      pid
 * anything else   raw bridge session id
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

const CUSTODIES: readonly Custody[] = ["controlled", "observed"];
const LANES: readonly Lane[] = ["dev", "installed"];

function matches(session: SessionFacts, selector: TargetSelector): boolean {
  const lower = selector.toLowerCase();
  if (CUSTODIES.some((c) => c === lower)) return session.custody === lower;
  if (LANES.some((l) => l === lower)) return session.lane === lower;
  if (lower.startsWith("session:"))
    return session.sdkSessionId === selector.slice("session:".length);
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
 * Mint the selector a UI writes when the user pins a session. Prefers the most stable selector
 * that is unambiguous in the CURRENT world: a pe-revit-launched session pins by its session id
 * (the SDK mints it and it survives restarts under the same name); the user's own Revit pins as
 * `observed` when it's the only observed session; else pid, which dies with the process.
 */
export function mintSelector(session: SessionFacts, all: readonly SessionFacts[]): TargetSelector {
  if (session.sdkSessionId) return `session:${session.sdkSessionId}`;
  if (all.filter((s) => s.custody === session.custody).length === 1) return session.custody;
  return String(session.processId);
}

/** Mint the active Revit document identity. The world remains only the call target. */
export function documentAddress(session: SessionFacts): Address | null {
  return addressSchema.safeParse(session.activeDocumentId).data ?? null;
}

/** Wire entry (bridge.sessions.list) → SessionFacts. Disconnected entries are not targets. */
export function fromBridgeSessions(
  entries: readonly {
    activeDocumentCloudModelGuid?: string | null;
    activeDocumentPath?: string | null;
    sessionId: string;
    connected: boolean;
    lane?: string | null;
    sdkSessionId?: string | null;
    custody?: string | null;
    processId?: number | null;
    activeDocumentTitle?: string | null;
    activeDocumentObservedAtUnixMs?: number | null;
    openDocumentCount: number;
  }[],
): SessionFacts[] {
  return entries
    .filter((e) => e.connected)
    .map((e) => ({
      sessionId: e.sessionId,
      processId: e.processId ?? 0,
      // Anything outside the SDK's union is no lane at all, not an invented "unknown" member.
      lane: LANES.find((l) => l === e.lane) ?? null,
      sdkSessionId: e.sdkSessionId ?? undefined,
      // The broker discloses custody; an entry that predates the field is treated as observed —
      // the read-only reading, which is the safe one to be wrong about.
      custody: CUSTODIES.find((c) => c === e.custody) ?? "observed",
      activeDocumentId: e.activeDocumentCloudModelGuid ?? e.activeDocumentPath ?? undefined,
      activeDocumentTitle: e.activeDocumentTitle ?? undefined,
      observedAtUnixMs: e.activeDocumentObservedAtUnixMs ?? undefined,
      openDocumentCount: e.openDocumentCount,
    }));
}

/** Short human phrase for a selector (chip text, tooltips). */
export function selectorLabel(selector: TargetSelector): string {
  if (selector === "") return "auto";
  if (selector.startsWith("session:")) return selector.slice("session:".length); // the id is the meaning
  if (/^\d+$/.test(selector)) return `pid ${selector}`;
  return selector;
}
