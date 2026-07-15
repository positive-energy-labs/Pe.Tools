/**
 * Target SCOPE — where a selector lives, and who owns it.
 *
 * `host/target.ts` answers "given a selector, what does it resolve to." This file answers the
 * question the three futures add: WHICH selector, for WHOM. Today the chat has one implicit scope.
 * Cross-tab sync, multi-plugin tenancy, and multiple revisitable threads are each just a different
 * question about the same two-axis address — so we capture the address and the book now, and grow
 * the backends into them later without touching `resolveTarget` or any scope-based caller:
 *
 *   - sync (N tabs agree)        → sync the TargetBook; resolution stays a local projection.
 *   - tenancy (N plugins)        → more consumerIds under one thread; inheritance below is the policy.
 *   - revisit (N threads)        → more threadIds; a book entry per thread, re-resolved on open.
 *
 * The book is a plain serializable object on purpose: that is exactly what a synced/persisted
 * store operates on. The only invariant to defend later is SINGLE-WRITER-PER-SCOPE — route every
 * write through one authority so two tabs can't fork one scope's pin.
 */

import {
  resolveTarget,
  type SessionFacts,
  type TargetResolution,
  type TargetSelector,
} from "#/host/target";

/** The chat itself, as a consumer. Plugins use their own id and inherit this one's pin by default. */
export const CHAT_CONSUMER = "_chat";

/** The address a selector lives at: one conversation thread × one consumer (chat or a plugin). */
export interface TargetScope {
  threadId: string;
  consumerId: string;
}

/** Serializable pin store: scopeKey → selector. Key PRESENT (even "") = own pin; ABSENT = inherit. */
export type TargetBook = Record<string, TargetSelector>;

// JSON-encoded tuple — collision-proof for any id contents, no magic separator to defend.
export function scopeKey(scope: TargetScope): string {
  return JSON.stringify([scope.threadId, scope.consumerId]);
}

/**
 * The selector governing a scope: its own pin if it has one, else the thread's chat pin (a plugin
 * riding the conversation), else "" (auto). The empty string is a real pin ("follow the sole
 * session"), distinct from an ABSENT entry ("inherit") — that distinction is the tenancy policy.
 */
export function readScoped(book: TargetBook, scope: TargetScope): TargetSelector {
  const own = book[scopeKey(scope)];
  if (own !== undefined) return own;
  if (scope.consumerId !== CHAT_CONSUMER)
    return book[scopeKey({ threadId: scope.threadId, consumerId: CHAT_CONSUMER })] ?? "";
  return "";
}

/** Single-writer pure update — set one scope's pin. "" pins to auto; clearScoped drops to inherit. */
export function writeScoped(
  book: TargetBook,
  scope: TargetScope,
  selector: TargetSelector,
): TargetBook {
  return { ...book, [scopeKey(scope)]: selector };
}

/** Drop a scope's own pin so it inherits again (a plugin handing targeting back to the chat). */
export function clearScoped(book: TargetBook, scope: TargetScope): TargetBook {
  const next = { ...book };
  delete next[scopeKey(scope)];
  return next;
}

/** A plugin scope riding the chat's pin rather than its own — the "inherited" UI affordance. */
export function isInherited(book: TargetBook, scope: TargetScope): boolean {
  return scope.consumerId !== CHAT_CONSUMER && book[scopeKey(scope)] === undefined;
}

/** Resolve a scope against the live world: read the governing selector, then the same pure resolver. */
export function resolveScoped(
  book: TargetBook,
  scope: TargetScope,
  sessions: readonly SessionFacts[],
): TargetResolution {
  return resolveTarget(sessions, readScoped(book, scope));
}
