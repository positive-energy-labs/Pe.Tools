import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Cross-tab thread claim — at most one browser tab may "own" (send to) a thread at a time;
 * other tabs are read-only and can take over. `localStorage` is the shared medium and the
 * `storage` event is the cross-tab signal (it fires in OTHER tabs on write, never the writer).
 * No backend, no library — this is the TUI's file-lock idea re-keyed by tab instead of PID.
 *
 * The server enforces the same invariant independently (a per-client run guard), so this layer
 * is the proactive UX: a second tab knows it's read-only before the user ever types.
 */

const CLAIMS_KEY = "pe.thread.claims";
const TAB_KEY = "pe.tab.id";
const TTL_MS = 15_000; // a claim older than this (owner tab closed/asleep) is reclaimable
const HEARTBEAT_MS = 5_000; // the owner refreshes its claim this often to stay fresh

interface Claim {
  tabId: string;
  at: number;
}
type Claims = Record<string, Claim>;

/** Owner of a thread in a claims snapshot, or undefined if unclaimed/stale. (Pure — testable.) */
export function ownerOf(claims: Claims, threadId: string, now: number): string | undefined {
  const claim = claims[threadId];
  return claim && now - claim.at < TTL_MS ? claim.tabId : undefined;
}

/**
 * Claim/refresh a thread if it's free, stale, or already ours (`force` = takeover). Pure:
 * returns the next claims map + whether we now own it. (Testable without localStorage.)
 */
export function claimInto(
  claims: Claims,
  threadId: string,
  tabId: string,
  now: number,
  force = false,
): { claims: Claims; got: boolean } {
  const owner = ownerOf(claims, threadId, now);
  if (!force && owner !== undefined && owner !== tabId) return { claims, got: false };
  return { claims: { ...claims, [threadId]: { tabId, at: now } }, got: true };
}

/** Drop our claim (on tab close / thread switch). A claim we don't own is left alone. Pure. */
export function releaseFrom(claims: Claims, threadId: string, tabId: string): Claims {
  if (claims[threadId]?.tabId !== tabId) return claims;
  const next = { ...claims };
  delete next[threadId];
  return next;
}

function readClaims(): Claims {
  try {
    const raw = localStorage.getItem(CLAIMS_KEY);
    return raw ? (JSON.parse(raw) as Claims) : {};
  } catch {
    return {};
  }
}

function writeClaims(claims: Claims): void {
  try {
    localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
  } catch {
    // ponytail: localStorage blocked (private mode) — cross-tab claim just won't engage.
  }
}

/** Stable per-tab id: survives reloads of this tab, gone when the tab closes. */
export function getTabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export interface ThreadClaim {
  tabId: string;
  isOwner: boolean;
  ownerTabId?: string;
  takeOver: () => void;
}

/** Own `threadId` for this tab; report read-only when another live tab holds it. */
export function useThreadClaim(threadId: string): ThreadClaim {
  const tabId = useMemo(getTabId, []);
  const [ownerTabId, setOwnerTabId] = useState<string | undefined>(tabId);

  const sync = useCallback(
    (force = false) => {
      const { claims, got } = claimInto(readClaims(), threadId, tabId, Date.now(), force);
      if (got) writeClaims(claims);
      setOwnerTabId(got ? tabId : ownerOf(readClaims(), threadId, Date.now()));
    },
    [threadId, tabId],
  );

  useEffect(() => {
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === CLAIMS_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    const heartbeat = window.setInterval(sync, HEARTBEAT_MS);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(heartbeat);
      writeClaims(releaseFrom(readClaims(), threadId, tabId));
    };
  }, [threadId, tabId, sync]);

  return { tabId, isOwner: ownerTabId === tabId, ownerTabId, takeOver: () => sync(true) };
}
