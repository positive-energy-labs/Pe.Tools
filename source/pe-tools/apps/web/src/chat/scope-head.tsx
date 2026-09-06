import {
  resolveScope,
  scopeDocument,
  type Address,
  type FleetSession,
  type Scope,
  type ScopeResolution,
} from "@pe/agent-contracts";

import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";

/** A connected SDK session and the document it has active, as the fleet reports it. */
export interface ScopeSessionOption extends FleetSession {
  label: string;
  documentLabel: string | null;
}

/** A document the user can pick: open in zero, one, or several sessions. */
export interface ScopeDocumentOption {
  document: Address;
  label: string;
  /** The Revit year that saved the file: the holder's year, or the header year of a recent. */
  year: number | null;
  /** Session ids holding it now; empty for a recent document nobody has open. */
  holders: string[];
}

/** Documents first: every session's active document, then recents nobody has open. */
export function scopeDocuments(
  sessions: readonly ScopeSessionOption[],
  recents: readonly { document: Address; label: string; year: number | null }[] = [],
): ScopeDocumentOption[] {
  const byDocument = new Map<Address, ScopeDocumentOption>();
  for (const session of sessions) {
    if (!session.document) continue;
    const entry = byDocument.get(session.document) ?? {
      document: session.document,
      label: session.documentLabel ?? session.document,
      year: session.year,
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
        year: recent.year,
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
        title: `session ${resolution.session}, via ${resolution.via}`,
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
        title:
          resolution.eligible.length === 0
            ? "no connected Revit of this document's year; start one"
            : `no connected session holds this document; open it in ${resolution.eligible.join(", ")}`,
        tone: "caution",
      };
    case "unchosen":
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
 * the head demand a session, and it offers exactly those holders (pinning it). Every mutating
 * tool card renders the revision it ran under next to this number, so drift between them is
 * visible. While pea is mid-turn the pickers are disabled: the turn keeps the Scope it was
 * admitted under. Paper, not house style: the sentence motif replaces this (protoui, round 3).
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
  const named = scopeDocument(scope);
  const fileYear = documents.find((option) => option.document === named)?.year ?? null;
  const resolution = resolveScope(scope, sessions, fileYear);
  const label = (document: Address | null) =>
    document === null
      ? "no document"
      : (documents.find((option) => option.document === document)?.label ?? document);
  const chip = chips(resolution, label);
  const busyTitle = busy ? "pea is mid-turn; the Scope is frozen" : undefined;
  return (
    <div
      data-testid="scope-head"
      data-scope={resolution.kind}
      className="flex flex-wrap items-center gap-2"
    >
      <FactChip tone={chip.tone} title={named ?? "no document"}>
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
                onSet({ kind: "document", document: resolution.document, pin: holder })
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
          state={named === option.document ? "selected" : "rest"}
          disabled={busy}
          title={
            busyTitle ??
            (option.holders.length === 0
              ? `${option.document} (not open; opening it is an instances verb)`
              : `${option.document} in ${option.holders.join(", ")}`)
          }
          onClick={() => onSet({ kind: "document", document: option.document })}
        >
          {option.label}
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
