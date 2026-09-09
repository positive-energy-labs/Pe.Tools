/**
 * Target model — the web-side view of the host's `resolveSessionTarget` (apps/host/src/bridge.ts).
 */

import type { Custody, Lane } from "@pe/host-contracts/contracts";
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";
import {
  addressSchema,
  resolveScope,
  resolveCallTarget,
  type Address,
  type FleetSession,
  type Scope,
} from "@pe/agent-contracts";

export type { Custody, Lane };

/** One Revit process incarnation, as observed by the broker. Projection of bridge session summary. */
export interface SessionFacts {
  /** The BROKER's id: hash(pid + processStartUtc). Not the pe-revit session id. */
  sessionId: string;
  processId: number;
  processStartUtcUnixMs?: number | null;
  /** Host/UI lane. The SDK payload source calls `dev` checkouts `checkout`. */
  lane: Lane | null;
  /** The id `pe-revit session list` prints, when this payload was launched by pe-revit. */
  sdkSessionId?: string;
  /** Revit major version reported by the loaded bridge. */
  year?: string;
  /**
   * `controlled` = pe-revit holds a receipt (full lifecycle); `observed` = it does not (reads
   * only). Disclosed by the broker. The UI must NOT re-implement the refusal — the SDK resolver
   * already refuses every mutation on `observed`, and a second guard here can only disagree.
   */
  custody: Custody;
  activeDocumentId?: string;
  activeDocumentTitle?: string;
  openDocumentCount: number;
  openDocuments?: BridgeSessionListEntry["openDocuments"];
  /** Set only on a document-bound view of this session, never on the fleet row. */
  openDocumentId?: string;
  /** activeDocumentObservedAtUnixMs from the bridge snapshot — an observation time, not computed staleness. */
  observedAtUnixMs?: number;
}

const CUSTODIES: readonly Custody[] = ["controlled", "observed"];
const LANES: readonly Lane[] = ["dev", "installed"];

/** Mint the active Revit document identity. The world remains only the call target. */
export function documentAddress(session: SessionFacts): Address | null {
  return addressSchema.safeParse(session.activeDocumentId).data ?? null;
}

/** Wire entry (bridge.sessions.list) → SessionFacts. Disconnected entries are not targets. */
export function fromBridgeSessions(entries: readonly BridgeSessionListEntry[]): SessionFacts[] {
  return entries
    .filter((e) => e.connected)
    .map((e) => ({
      sessionId: e.sessionId,
      processId: e.processId ?? 0,
      processStartUtcUnixMs: e.processStartUtcUnixMs ?? null,
      // Anything outside the SDK's union is no lane at all, not an invented "unknown" member.
      lane: LANES.find((l) => l === e.lane) ?? null,
      sdkSessionId: e.sdkSessionId ?? undefined,
      year: e.revitVersion ?? undefined,
      // The broker discloses custody; an entry that predates the field is treated as observed —
      // the read-only reading, which is the safe one to be wrong about.
      custody: CUSTODIES.find((c) => c === e.custody) ?? "observed",
      activeDocumentId: e.activeDocumentCloudModelGuid ?? e.activeDocumentPath ?? undefined,
      activeDocumentTitle: e.activeDocumentTitle ?? undefined,
      observedAtUnixMs: e.activeDocumentObservedAtUnixMs ?? undefined,
      openDocumentCount: e.openDocumentCount,
      openDocuments: e.openDocuments,
    }));
}

/** The id a Scope pin names: the pe-revit session id when the payload has one, else the broker's. */
export const sessionKey = (session: SessionFacts): string =>
  session.sdkSessionId ?? session.sessionId;

/** SessionFacts → the fleet row `resolveScope` reads. Year is the eligibility key (ADR 0010). */
export const fleetOf = (sessions: readonly SessionFacts[]): FleetSession[] =>
  sessions.map((session) => ({
    id: sessionKey(session),
    year: session.year ? Number(session.year) : null,
    document: documentAddress(session),
  }));

/**
 * The one session a Scope resolves to, as the broker's facts. `resolveScope` (@pe/agent-contracts)
 * is the only rule; this is the adapter between it and the bridge session list.
 */
export function scopeSession(scope: Scope, sessions: readonly SessionFacts[]): SessionFacts | null {
  const resolution = resolveScope(scope, fleetOf(sessions));
  return resolution.kind === "resolved"
    ? (sessions.find((session) => sessionKey(session) === resolution.session) ?? null)
    : null;
}

/** Exact document selection for migrated consumers. A selected session never falls back. */
export function documentSession(
  scope: Scope,
  sessions: readonly SessionFacts[],
): SessionFacts | null {
  if (scope.kind !== "document" || !scope.pin) return null;
  const candidates = sessions.filter(
    (session) => session.sessionId === scope.pin || sessionKey(session) === scope.pin,
  );
  const session = candidates.length === 1 ? candidates[0] : undefined;
  if (!session?.openDocuments) return null;
  const result = resolveCallTarget(
    { needs: "document" },
    { kind: "named", session: session.sessionId, address: scope.document },
    {
      kind: "ready",
      sessions: {
        [session.sessionId]: {
          kind: "ready",
          values: session.openDocuments.map((document) => ({
            openId: document.openId,
            address: addressSchema.safeParse(document.address).data ?? null,
            kind: document.isFamilyDocument ? "family" : "project",
          })),
        },
      },
    },
  );
  return result.kind === "resolved" && result.target.kind === "document"
    ? { ...session, openDocumentId: result.target.ref.openId }
    : null;
}
