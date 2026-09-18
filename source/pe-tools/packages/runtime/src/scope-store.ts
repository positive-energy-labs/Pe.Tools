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
  readonly #pending = new Set<string>();
  readonly #tails = new Map<string, Promise<void>>();
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
    refuse?: () => PutTargetResult | undefined,
  ): Promise<PutTargetResult> {
    return this.#serialized(threadId, () =>
      Promise.resolve(refuse?.() ?? this.#set(threadId, defaultTarget, expectedRevision)),
    );
  }

  async #set(
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

  admit<T>(threadId: string, turnId: string, work: (head: ThreadHead) => Promise<T>): Promise<T> {
    return this.#serialized(threadId, async () => {
      const head = await this.read(threadId);
      const previousTurn = this.#turns.get(threadId);
      this.#turns.set(threadId, turnId);
      this.#pending.add(threadId);
      try {
        const result = await work(head);
        this.#pending.delete(threadId);
        return result;
      } catch (error) {
        this.#pending.delete(threadId);
        if (this.#turns.get(threadId) === turnId) {
          if (previousTurn) this.#turns.set(threadId, previousTurn);
          else this.#turns.delete(threadId);
        }
        throw error;
      }
    });
  }

  admittedTurn(threadId: string): string | undefined {
    return this.#turns.get(threadId);
  }

  admissionPending(threadId: string): boolean {
    return this.#pending.has(threadId);
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
  #serialized<T>(threadId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(threadId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(threadId, tail);
    return run.finally(() => {
      if (this.#tails.get(threadId) === tail) this.#tails.delete(threadId);
    });
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
  const id = crypto.randomUUID();
  await scopes.admit(thread, id, async (head) => {
    const turn: Turn = { id, thread, ...head };
    const requestContext =
      input.requestContext instanceof RequestContext ? input.requestContext : new RequestContext();
    (requestContext as RequestContext<Record<string, unknown>>).set(turnContextKey, turn);
    const signal = session.sendSignal(
      {
        type: "user",
        tagName: "user",
        id: turn.id,
        contents: messageContents(input.content, input.files),
        metadata: { turn },
      },
      { requestContext, requireDelivery: true },
    );
    await signal.accepted;
  });
}
