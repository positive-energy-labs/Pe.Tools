import type { Address, Scope } from "@pe/agent-contracts";

import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";

export interface ScopeSessionOption {
  id: string;
  label: string;
  document: Address | null;
  documentLabel: string | null;
}

export type ScopeHeadState =
  | { kind: "absent" }
  | { kind: "set"; session: ScopeSessionOption }
  | { kind: "dangling"; session: string };

export function scopeHeadState(
  scope: Scope,
  options: readonly ScopeSessionOption[],
): ScopeHeadState {
  if (!scope.session) return { kind: "absent" };
  const session = options.find((option) => option.id === scope.session);
  return session ? { kind: "set", session } : { kind: "dangling", session: scope.session };
}

/**
 * THE one place the user sees and changes the thread's Scope. Every mutating tool card renders the
 * revision it ran under next to this number, so drift between them is visible. While pea is
 * mid-turn the pickers are disabled: the turn keeps the Scope it was admitted under.
 */
export function ScopeHead({
  scope,
  revision,
  options,
  busy,
  refusal,
  onSet,
}: {
  scope: Scope;
  revision: number;
  options: readonly ScopeSessionOption[];
  /** pea is mid-turn: the head shows but refuses changes. */
  busy: boolean;
  refusal?: string | null;
  onSet: (next: Scope) => void;
}) {
  const state = scopeHeadState(scope, options);
  const tone = state.kind === "set" ? "meta" : "caution";
  const documentLabel =
    state.kind === "set" ? state.session.documentLabel : (scope.document ?? null);
  return (
    <div data-testid="scope-head" data-scope={state.kind} className="flex items-center gap-2">
      <FactChip
        tone={tone}
        title={
          state.kind === "set"
            ? `session ${state.session.id}`
            : state.kind === "dangling"
              ? `session ${state.session} is not connected`
              : "no session: the host picks the only connected session, or refuses"
        }
      >
        {state.kind === "absent"
          ? "no session"
          : state.kind === "dangling"
            ? `${state.session} ∅`
            : state.session.label}
      </FactChip>
      <FactChip tone={scope.document ? "meta" : "caution"} title={scope.document ?? "no document"}>
        {documentLabel ?? "no document"}
      </FactChip>
      <span
        className="t-small face-mono text-ink-2"
        title="Scope revision"
        data-testid="scope-revision"
      >
        r{revision}
      </span>
      {options.map((option) => (
        <Press
          key={option.id}
          type="button"
          tone="neutral"
          state={scope.session === option.id ? "selected" : "rest"}
          disabled={busy}
          title={busy ? "pea is mid-turn; the Scope is frozen" : `target ${option.label}`}
          onClick={() => onSet({ session: option.id, document: option.document })}
        >
          {option.label}
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
