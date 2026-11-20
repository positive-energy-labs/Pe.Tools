import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Cause, Effect, Exit } from "effect";
import type { z } from "zod";
import type { DocumentRef } from "@pe/agent-contracts";
import { read as readStoredFile, stateKind, type StateDirectory } from "@pe/host-contracts/kinds";
import { writeArtifact } from "./write-artifact.ts";

type Kept = { readonly id: string };
/** What one document's capture of a kind is doing now. A failure names the capture it replaced. */
export type CaptureStatus =
  | { kind: "empty"; target: DocumentRef }
  | { kind: "reading"; target: DocumentRef; previousId?: string }
  | { kind: "ready"; target: DocumentRef; captureId: string }
  | { kind: "failed"; target: DocumentRef; error: string; previousId?: string };
const previousOf = (state: CaptureStatus) =>
  state.kind === "ready"
    ? { previousId: state.captureId }
    : state.kind !== "empty" && state.previousId
      ? { previousId: state.previousId }
      : {};
/** One kind's live state. It holds ids only, so it is the same for every kind. */
class Live {
  readonly states = new Map<string, CaptureStatus>();
  readonly generations = new Map<string, number>();
  /** Requesters inside `refresh` per document; the last one out settles a state nobody else will. */
  readonly refreshing = new Map<string, number>();
  clear() {
    this.states.clear();
    this.generations.clear();
    this.refreshing.clear();
  }
}
const keyOf = (target: DocumentRef) => JSON.stringify([target.session, target.openId]);

/**
 * One declared capture kind: immutable files named by their content, and each document's live
 * state. A product reads through this; the kernel keeps what an `emits` body returns.
 */
export class KeptCaptures<T extends Kept> {
  private readonly files;
  constructor(
    private readonly storage: StateDirectory,
    private readonly kind: string,
    private readonly schema: z.ZodType<T>,
    private readonly live: Live,
  ) {
    // Captures are derived files (ADR 0039 rule 1): one that does not decode reads as missing.
    this.files = stateKind({
      schema,
      place: (_id: string) => "Captures",
      segments: (id: string) => [kind, `${id}.json`],
    });
  }
  private path(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("A capture id is 64 hex characters");
    return join(this.storage.path, this.kind, `${id}.json`);
  }
  status(target: DocumentRef): CaptureStatus {
    return this.live.states.get(keyOf(target)) ?? { kind: "empty", target };
  }
  invalidate(target: DocumentRef): void {
    const { states, generations } = this.live;
    const key = keyOf(target);
    const previous = previousOf(this.status(target));
    generations.set(key, (generations.get(key) ?? 0) + 1);
    states.set(key, {
      kind: "failed",
      target,
      error: "Model changed; refresh geometry.",
      ...previous,
    });
  }

  /** NativeReads joins peers (ADR 0029). Only invalidation fences an in-flight refresh. */
  readonly refresh = Effect.fn("KeptCaptures.refresh")(function* <A, E, R, E2, R2>(
    this: KeptCaptures<T>,
    target: DocumentRef,
    collect: Effect.Effect<A & { readonly capture: Omit<T, "id"> }, E, R>,
    current: Effect.Effect<boolean, E2, R2>,
  ) {
    const self = this;
    const { states, generations, refreshing } = this.live;
    const key = keyOf(target);
    const generation = generations.get(key) ?? 0;
    const fenced = () => (generations.get(key) ?? 0) !== generation;
    const previous = previousOf(this.status(target));
    refreshing.set(key, (refreshing.get(key) ?? 0) + 1);
    states.set(key, { kind: "reading", target, ...previous });
    const assertCurrent = Effect.gen(function* () {
      if (fenced() || !(yield* current))
        return yield* Effect.fail(
          new Error("Snapshot target or generation changed before publication."),
        );
    });
    return yield* Effect.gen(function* () {
      const result = yield* collect;
      yield* assertCurrent;
      const capture = yield* Effect.tryPromise({
        try: () => self.keep(result.capture),
        catch: (error) => error,
      });
      yield* assertCurrent;
      states.set(key, { kind: "ready", target, captureId: capture.id });
      return { result, capture };
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const left = (refreshing.get(key) ?? 1) - 1;
          if (left) refreshing.set(key, left);
          else refreshing.delete(key);
          // A peer still reading settles the state; a newer generation already replaced it.
          if (Exit.isSuccess(exit) || left || fenced()) return;
          const error = Cause.hasInterrupts(exit.cause)
            ? Error("Snapshot read was cancelled.")
            : Cause.squash(exit.cause);
          states.set(key, {
            kind: "failed",
            target,
            error:
              typeof error === "object" && error !== null && "message" in error
                ? String(error.message)
                : String(error),
            ...previous,
          });
        }),
      ),
    );
  });

  async saved(id: string): Promise<T> {
    const path = this.path(id);
    const stored = readStoredFile(this.files.in(this.storage, id));
    if (stored.kind !== "ok")
      throw Object.assign(Error(`ENOENT: no readable capture at '${path}'`), { code: "ENOENT" });
    return stored.value;
  }
  /** Return exact stored bytes after validating the id, including malformed JSON. */
  async savedText(id: string): Promise<{ path: string; text: string }> {
    const path = this.path(id);
    return { path, text: await readFile(path, "utf8") };
  }
  async list(): Promise<T[]> {
    // ponytail: directory scan for this bounded capture store; index if measured volume demands it.
    const files = await readdir(join(this.storage.path, this.kind)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    return Promise.all(
      files
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map((name) => this.saved(name.slice(0, -5))),
    );
  }
  /** Keep this exact value; the acquiring read owns its scope and freshness fence. */
  async keep(value: Omit<T, "id">, current?: () => Promise<void>): Promise<T> {
    const id = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const capture = this.schema.parse({ id, ...value });
    await current?.();
    await writeArtifact(
      join(this.storage.path, this.kind),
      this.files.in(this.storage, id),
      JSON.stringify(capture),
    );
    // Cancellation withdraws the answer, never immutable bytes a peer may already reference.
    await current?.();
    return capture;
  }
}

/** Every declared kind of one store, each with one live state for the store's life. */
export class CaptureKinds {
  private readonly kinds = new Map<string, Live>();
  constructor(private readonly storage: StateDirectory) {}
  of<T extends Kept>(kind: string, schema: z.ZodType<T>): KeptCaptures<T> {
    const live = this.kinds.get(kind) ?? new Live();
    this.kinds.set(kind, live);
    return new KeptCaptures(this.storage, kind, schema, live);
  }
  clear() {
    for (const live of this.kinds.values()) live.clear();
  }
}
/** A product's declared kind in the kernel store. The kind is a key of its declaration. */
// ponytail: a product of two kinds reads the union of their values here; key `T` by kind then.
export const captured = <K extends string, T extends Kept>(
  store: { readonly kept: CaptureKinds },
  product: { readonly captures: Readonly<Record<K, z.ZodType<T>>> },
  kind: NoInfer<K>,
) => store.kept.of(kind, product.captures[kind]);
