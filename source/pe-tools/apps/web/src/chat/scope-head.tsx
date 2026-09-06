import {
  resolveScope,
  scopeDocument,
  scopeSession,
  type Address,
  type Scope,
  type ScopeResolution,
} from "@pe/agent-contracts";

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

/** The two chips the head shows for a resolution: what document, what session, and the tone. */
function chips(
  resolution: ScopeResolution,
  label: (document: Address | null) => string,
): { document: string; session: string; title: string; tone: "meta" | "caution" } {
  switch (resolution.kind) {
    case "resolved":
      return {
        document: label(resolution.document),
        session: resolution.session,
        title: `session ${resolution.session}`,
        tone: "meta",
      };
    case "ambiguous":
      return {
        document: label(resolution.document),
        session: "pick a session",
        title: `${resolution.holders.length} sessions hold this document; pick one`,
        tone: "caution",
      };
    case "unheld":
      return {
        document: label(resolution.document),
        session: "no holder ∅",
        title: "no connected session holds this document",
        tone: "caution",
      };
    case "gone":
      return {
        document: "no document",
        session: `${resolution.session} ∅`,
        title: `session ${resolution.session} is not connected`,
        tone: "caution",
      };
    case "nothing":
      return {
        document: "no document",
        session: "no session",
        title:
          resolution.sessions.length === 0
            ? "no Revit session is connected"
            : `${resolution.sessions.length} sessions connected; pick a document`,
        tone: "caution",
      };
  }
}

/**
 * THE one place the user sees and changes the thread's Scope. The user picks a DOCUMENT; the
 * session is derived from its one holder. Only when two sessions hold the picked document does
 * the head demand a session, and it offers exactly those holders (pinning it). A session with
 * nothing open is still pickable (a lifecycle target). Every mutating tool card renders the
 * revision it ran under next to this number, so drift between them is visible. While pea is
 * mid-turn the pickers are disabled: the turn keeps the Scope it was admitted under.
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
  const resolution = resolveScope(scope, sessions);
  const label = (document: Address | null) =>
    document === null
      ? "no document"
      : (documents.find((option) => option.document === document)?.label ?? document);
  const chip = chips(resolution, label);
  const namedDocument = scopeDocument(scope);
  const namedSession = scopeSession(scope);
  const busyTitle = busy ? "pea is mid-turn; the Scope is frozen" : undefined;
  return (
    <div
      data-testid="scope-head"
      data-scope={resolution.kind}
      className="flex flex-wrap items-center gap-2"
    >
      <FactChip tone={chip.tone} title={namedDocument ?? "no document"}>
        {chip.document}
      </FactChip>
      <FactChip tone={chip.tone} title={chip.title}>
        {chip.session}
      </FactChip>
      <span
        className="t-small face-mono text-ink-2"
        title="Scope revision"
        data-testid="scope-revision"
      >
        r{revision}
      </span>
      {resolution.kind === "ambiguous"
        ? resolution.holders.map((holder) => (
            <Press
              key={holder}
              type="button"
              tone="agent"
              disabled={busy}
              title={busyTitle ?? `run in ${holder}`}
              onClick={() =>
                onSet({ kind: "pinned", session: holder, document: resolution.document })
              }
            >
              {sessions.find((session) => session.id === holder)?.label ?? holder}
            </Press>
          ))
        : null}
      {documents.map((option) => (
        <Press
          key={option.document}
          type="button"
          tone="neutral"
          state={namedDocument === option.document ? "selected" : "rest"}
          disabled={busy}
          title={
            busyTitle ??
            (option.holders.length === 0
              ? `${option.document} (not open; a lifecycle target)`
              : `${option.document} in ${option.holders.join(", ")}`)
          }
          onClick={() => onSet({ kind: "document", document: option.document })}
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
            state={namedSession === session.id ? "selected" : "rest"}
            disabled={busy}
            title={busyTitle ?? `${session.label} has nothing open`}
            onClick={() => onSet({ kind: "session", session: session.id })}
          >
            {session.label} ∅
          </Press>
        ))}
      {scope.kind !== "none" ? (
        <Press type="button" tone="quiet" disabled={busy} onClick={() => onSet({ kind: "none" })}>
          clear scope
        </Press>
      ) : null}
      {refusal ? <span className="t-small text-ink-2">{refusal}</span> : null}
    </div>
  );
}
