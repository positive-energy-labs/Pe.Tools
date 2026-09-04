import type { Address, Scope } from "@pe/agent-contracts";

import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";

/** A connected SDK session and the document it has active, as the fleet reports it. */
export interface ScopeSessionOption {
  id: string;
  label: string;
  document: Address | null;
  documentLabel: string | null;
}

/** A document the user can pick: open in zero, one, or several sessions. */
export interface ScopeDocumentOption {
  document: Address;
  label: string;
  /** Session ids holding it now; empty for a recent document nobody has open. */
  holders: string[];
}

export type ScopeHeadState =
  | { kind: "absent" }
  | { kind: "set"; session: string | null; documentLabel: string | null }
  | { kind: "dangling"; session: string | null; documentLabel: string | null }
  | { kind: "ambiguous"; documentLabel: string; holders: ScopeSessionOption[] };

/** Documents first: every session's active document, then recents nobody has open. */
export function scopeDocuments(
  sessions: readonly ScopeSessionOption[],
  recents: readonly { document: Address; label: string }[] = [],
): ScopeDocumentOption[] {
  const byDocument = new Map<Address, ScopeDocumentOption>();
  for (const session of sessions) {
    if (!session.document) continue;
    const entry = byDocument.get(session.document) ?? {
      document: session.document,
      label: session.documentLabel ?? session.document,
      holders: [],
    };
    entry.holders.push(session.id);
    byDocument.set(session.document, entry);
  }
  for (const recent of recents)
    if (!byDocument.has(recent.document))
      byDocument.set(recent.document, {
        document: recent.document,
        label: recent.label,
        holders: [],
      });
  return [...byDocument.values()];
}

export function scopeHeadState(
  scope: Scope,
  sessions: readonly ScopeSessionOption[],
  documents: readonly ScopeDocumentOption[],
): ScopeHeadState {
  const session = scope.session ? sessions.find((option) => option.id === scope.session) : null;
  const document = scope.document
    ? documents.find((option) => option.document === scope.document)
    : null;
  const documentLabel = document?.label ?? scope.document ?? null;
  if (!scope.session && !scope.document) return { kind: "absent" };
  if (scope.session && !session) return { kind: "dangling", session: scope.session, documentLabel };
  if (scope.document && !scope.session) {
    const holders = sessions.filter((option) => option.document === scope.document);
    if (holders.length > 1) return { kind: "ambiguous", documentLabel: documentLabel!, holders };
    if (holders.length === 0) return { kind: "dangling", session: null, documentLabel };
  }
  return { kind: "set", session: scope.session, documentLabel };
}

/**
 * THE one place the user sees and changes the thread's Scope. The user picks a DOCUMENT; the
 * session is derived from its one holder. Only when two sessions hold the picked document does
 * the head demand a session, and it offers exactly those holders. A session with nothing open is
 * still pickable (a lifecycle target). Every mutating tool card renders the revision it ran under
 * next to this number, so drift between them is visible. While pea is mid-turn the pickers are
 * disabled: the turn keeps the Scope it was admitted under.
 */
export function ScopeHead({
  scope,
  revision,
  sessions,
  documents,
  busy,
  refusal,
  onSet,
}: {
  scope: Scope;
  revision: number;
  sessions: readonly ScopeSessionOption[];
  documents: readonly ScopeDocumentOption[];
  /** pea is mid-turn: the head shows but refuses changes. */
  busy: boolean;
  refusal?: string | null;
  onSet: (next: Scope) => void;
}) {
  const state = scopeHeadState(scope, sessions, documents);
  const tone = state.kind === "set" ? "meta" : "caution";
  const busyTitle = busy ? "pea is mid-turn; the Scope is frozen" : undefined;
  return (
    <div
      data-testid="scope-head"
      data-scope={state.kind}
      className="flex flex-wrap items-center gap-2"
    >
      <FactChip tone={scope.document ? tone : "caution"} title={scope.document ?? "no document"}>
        {state.kind === "absent" ? "no document" : (state.documentLabel ?? "no document")}
      </FactChip>
      <FactChip
        tone={tone}
        title={
          state.kind === "ambiguous"
            ? `${state.holders.length} sessions hold this document; pick one`
            : state.kind === "dangling"
              ? state.session
                ? `session ${state.session} is not connected`
                : "no connected session holds this document"
              : state.kind === "set" && state.session
                ? `session ${state.session}`
                : "no session: the host derives it from the document, or picks the only one"
        }
      >
        {state.kind === "ambiguous"
          ? "pick a session"
          : state.kind === "dangling"
            ? `${state.session ?? "no holder"} ∅`
            : state.kind === "set"
              ? (state.session ?? "derived")
              : "no session"}
      </FactChip>
      <span
        className="t-small face-mono text-ink-2"
        title="Scope revision"
        data-testid="scope-revision"
      >
        r{revision}
      </span>
      {state.kind === "ambiguous"
        ? state.holders.map((holder) => (
            <Press
              key={holder.id}
              type="button"
              tone="agent"
              disabled={busy}
              title={busyTitle ?? `run in ${holder.label}`}
              onClick={() => onSet({ session: holder.id, document: scope.document })}
            >
              {holder.label}
            </Press>
          ))
        : null}
      {documents.map((option) => (
        <Press
          key={option.document}
          type="button"
          tone="neutral"
          state={scope.document === option.document ? "selected" : "rest"}
          disabled={busy}
          title={
            busyTitle ??
            (option.holders.length === 0
              ? `${option.document} (not open; a lifecycle target)`
              : `${option.document} in ${option.holders.join(", ")}`)
          }
          onClick={() =>
            onSet({
              document: option.document,
              session: option.holders.length === 1 ? option.holders[0]! : null,
            })
          }
        >
          {option.label}
        </Press>
      ))}
      {sessions
        .filter((session) => !session.document)
        .map((session) => (
          <Press
            key={session.id}
            type="button"
            tone="quiet"
            state={scope.session === session.id ? "selected" : "rest"}
            disabled={busy}
            title={busyTitle ?? `${session.label} has nothing open`}
            onClick={() => onSet({ session: session.id, document: null })}
          >
            {session.label} ∅
          </Press>
        ))}
      {scope.session || scope.document ? (
        <Press
          type="button"
          tone="quiet"
          disabled={busy}
          onClick={() => onSet({ session: null, document: null })}
        >
          clear scope
        </Press>
      ) : null}
      {refusal ? <span className="t-small text-ink-2">{refusal}</span> : null}
    </div>
  );
}
