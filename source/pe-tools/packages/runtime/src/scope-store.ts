import { RequestContext } from "@mastra/core/request-context";
import type { Session } from "@mastra/core/agent-controller";
import {
  emptyScope,
  scopeRevisionSchema,
  turnContextKey,
  type Scope,
  type ScopeRevision,
  type Turn,
} from "@pe/agent-contracts";
import { messageContents } from "./message-contents.ts";

export interface ScopeStateStore {
  getState(input: { threadId: string; type: string }): Promise<unknown>;
  setState(input: { threadId: string; type: string; value: unknown }): Promise<void>;
}

const scopeType = (threadId: string) => `scope:${threadId}`;

/**
 * The host-owned Scope per chat thread: one row beside the thread, one revision counter, one
 * publisher. A turn is admitted under the revision current at admission and keeps it until it
 * ends; `admit` records which turn holds the thread so the human head can be refused mid-turn.
 */
export class ScopeStore {
  readonly #listeners = new Set<(threadId: string, next: ScopeRevision) => void>();
  readonly #turns = new Map<string, string>();

  constructor(
    private readonly store: () => Promise<ScopeStateStore>,
    private readonly resourceId: string,
  ) {}

  async read(threadId: string): Promise<ScopeRevision> {
    const raw = await (
      await this.store()
    ).getState({
      threadId: this.resourceId,
      type: scopeType(threadId),
    });
    return scopeRevisionSchema.safeParse(raw).data ?? { scope: emptyScope, revision: 0 };
  }

  async set(threadId: string, scope: Scope, expectedRevision: number): Promise<ScopeRevision> {
    const current = await this.read(threadId);
    if (current.revision !== expectedRevision)
      throw new ScopeRefused(`scope is at revision ${current.revision}; re-read before setting.`);
    const next = { scope, revision: current.revision + 1 };
    await (
      await this.store()
    ).setState({
      threadId: this.resourceId,
      type: scopeType(threadId),
      value: next,
    });
    for (const listener of this.#listeners) listener(threadId, next);
    return next;
  }

  admit(threadId: string, turnId: string): void {
    this.#turns.set(threadId, turnId);
  }

  admittedTurn(threadId: string): string | undefined {
    return this.#turns.get(threadId);
  }

  subscribe(listener: (threadId: string, next: ScopeRevision) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export class ScopeRefused extends Error {}

type MessageFile = { data: string; mediaType: string; filename?: string };

/** Admit one user turn under the thread's current Scope revision, frozen into requestContext. */
export async function admitTurn(
  scopes: ScopeStore,
  session: Session,
  input: { content: string; files?: MessageFile[]; requestContext?: unknown },
): Promise<void> {
  const thread = session.thread.requireId();
  const turn: Turn = { id: crypto.randomUUID(), thread, ...(await scopes.read(thread)) };
  const requestContext =
    input.requestContext instanceof RequestContext ? input.requestContext : new RequestContext();
  (requestContext as RequestContext<Record<string, unknown>>).set(turnContextKey, turn);
  scopes.admit(thread, turn.id);
  const signal = session.sendSignal(
    {
      type: "user",
      tagName: "user",
      id: turn.id,
      contents: messageContents(input.content, input.files),
      metadata: { turn },
    },
    { requestContext },
  );
  await signal.accepted;
}
