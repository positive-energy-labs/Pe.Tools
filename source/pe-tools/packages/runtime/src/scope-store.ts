import { RequestContext } from "@mastra/core/request-context";
import type { Session } from "@mastra/core/agent-controller";
import {
  threadHeadSchema,
  turnContextKey,
  type DocumentRequest,
  type PutTargetResult,
  type ThreadHead,
  type Turn,
} from "@pe/agent-contracts";
import { messageContents } from "./message-contents.ts";
import { OwnerReads, type OwnerValue } from "./owner-read.ts";

export interface ScopeStateStore {
  getState(input: { threadId: string; type: string }): Promise<unknown>;
  setState(input: { threadId: string; type: string; value: unknown }): Promise<void>;
}

const scopeType = (threadId: string) => `scope:${threadId}`;

/**
 * The host-owned default Target per chat thread: one row beside the thread, one revision counter, one
 * publisher. A turn is admitted under the revision current at admission and keeps it until it
 * ends; `admit` records which turn holds the thread so the human head can be refused mid-turn.
 */
export class ScopeStore {
  readonly #listeners = new Set<(threadId: string, next: ThreadHead) => void>();
  readonly #turns = new Map<string, string>();
  readonly #reads = new OwnerReads();

  constructor(
    private readonly store: () => Promise<ScopeStateStore>,
    private readonly resourceId: string,
  ) {}

  async read(threadId: string): Promise<ThreadHead> {
    const raw = await (
      await this.store()
    ).getState({
      threadId: this.resourceId,
      type: scopeType(threadId),
    });
    const parsed = threadHeadSchema.safeParse(raw);
    if (raw != null && !parsed.success)
      console.warn(`scope ${threadId}: stored head no longer parses, reading as none`, raw);
    return parsed.data ?? { defaultTarget: null, revision: 0 };
  }

  /** Every write says what it read: a stale `expectedRevision` returns the current Head instead. */
  async set(
    threadId: string,
    defaultTarget: DocumentRequest | null,
    expectedRevision: number,
  ): Promise<PutTargetResult> {
    const current = await this.read(threadId);
    if (current.revision !== expectedRevision) return { ok: false, why: "stale", head: current };
    const next: ThreadHead = { defaultTarget, revision: current.revision + 1 };
    await (
      await this.store()
    ).setState({
      threadId: this.resourceId,
      type: scopeType(threadId),
      value: next,
    });
    for (const listener of this.#listeners) listener(threadId, next);
    return { ok: true, why: "set", head: next };
  }

  admit(threadId: string, turnId: string): void {
    this.#turns.set(threadId, turnId);
  }

  admittedTurn(threadId: string): string | undefined {
    return this.#turns.get(threadId);
  }

  subscribe(listener: (threadId: string, next: ThreadHead) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  observe(threadId: string, listener: (value: OwnerValue<ThreadHead>) => void): () => void {
    return this.#reads.observe(
      threadId,
      () => this.read(threadId),
      (notify) =>
        this.subscribe((thread) => {
          if (thread === threadId) notify();
        }),
      listener,
    );
  }
}

type MessageFile = { data: string; mediaType: string; filename?: string };

/** Admit one user turn under the thread head's current revision, frozen into requestContext. */
export async function admitTurn(
  scopes: ScopeStore,
  session: Session,
  input: { content: string; files?: MessageFile[]; requestContext?: unknown },
): Promise<void> {
  const thread = session.thread.requireId();
  const head = await scopes.read(thread);
  const turn: Turn = {
    id: crypto.randomUUID(),
    thread,
    ...head,
  };
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
