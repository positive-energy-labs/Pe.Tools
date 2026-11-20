import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Cause, Effect, Exit } from "effect";
import type { OwnerValue } from "@pe/runtime";
import type { Address, DocumentRef } from "@pe/agent-contracts";
import { addressSchema, sameAddress } from "@pe/agent-contracts";
import { product } from "@pe/rooms-contract/product";
import type { z } from "zod";
import { writeArtifact } from "@pe/host-internal/write-artifact";
import {
  ObservationFiles,
  captureKind,
  storedCapture,
  missingCapture,
  keyOf,
} from "@pe/host-internal/observation-files";
import {
  takeoffCaptureSchema,
  takeoffObservationSchema,
  takeoffSnapshotSchema,
  type TakeoffCapture,
  type TakeoffObservation,
  type TakeoffSnapshot,
} from "@pe/rooms-contract/takeoffs";

const previousOf = (state: TakeoffObservation) =>
  state.kind === "ready" ? state.capture : state.kind === "empty" ? undefined : state.previous;

export class TakeoffCaptures extends ObservationFiles {
  private readonly states = new Map<string, TakeoffObservation>();
  private readonly generations = new Map<string, number>();
  /** Requesters inside `refresh` per document; the last one out settles a state nobody else will. */
  private readonly refreshing = new Map<string, number>();
  override async close() {
    await super.close();
    this.states.clear();
    this.generations.clear();
    this.refreshing.clear();
  }

  private setState(key: string, state: TakeoffObservation) {
    this.states.set(key, state);
    this.notify(key);
  }
  observe(target: DocumentRef, listener: (value: OwnerValue<TakeoffObservation>) => void) {
    const key = keyOf(target);
    return this.reads.observe(
      key,
      async () => this.read(target),
      (notify) => this.subscribe(key, notify),
      listener,
    );
  }
  read(target: DocumentRef): TakeoffObservation {
    return structuredClone(this.states.get(keyOf(target)) ?? { kind: "empty", target });
  }

  status(target: DocumentRef) {
    const state = this.states.get(keyOf(target)) ?? { kind: "empty" as const, target };
    if (state.kind === "ready") return { kind: state.kind, target, captureId: state.capture.id };
    if (state.kind === "empty") return state;
    const { previous, ...status } = state;
    return { ...status, ...(previous ? { previousId: previous.id } : {}) };
  }

  invalidate(target: DocumentRef): void {
    const key = keyOf(target);
    const previous = previousOf(this.read(target));
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.setState(key, {
      kind: "failed",
      target,
      error: "Model changed; refresh geometry.",
      ...(previous ? { previous } : {}),
    });
  }

  /** NativeReads joins peers (ADR 0029). Only invalidation fences an in-flight refresh. */
  readonly refresh = Effect.fn("TakeoffCaptures.refresh")(function* <A, E, R, E2, R2>(
    this: TakeoffCaptures,
    target: DocumentRef,
    collect: Effect.Effect<{ result: A; snapshot: TakeoffSnapshot }, E, R>,
    current: Effect.Effect<boolean, E2, R2>,
  ) {
    const self = this;
    const key = keyOf(target);
    const generation = this.generations.get(key) ?? 0;
    const fenced = () => (self.generations.get(key) ?? 0) !== generation;
    const previous = previousOf(this.read(target));
    this.refreshing.set(key, (this.refreshing.get(key) ?? 0) + 1);
    this.setState(key, { kind: "reading", target, ...(previous ? { previous } : {}) });
    const assertCurrent = Effect.gen(function* () {
      if (fenced() || !(yield* current))
        return yield* Effect.fail(
          new Error("Snapshot target or generation changed before publication."),
        );
    });
    return yield* Effect.gen(function* () {
      const { result, snapshot } = yield* collect;
      yield* assertCurrent;
      const capture = yield* Effect.tryPromise({
        try: () => self.retain(snapshot, { kind: "live", target }),
        catch: (error) => error,
      });
      yield* assertCurrent;
      self.setState(key, takeoffObservationSchema.parse({ kind: "ready", target, capture }));
      return { result, capture };
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const left = (self.refreshing.get(key) ?? 1) - 1;
          if (left) self.refreshing.set(key, left);
          else self.refreshing.delete(key);
          // A peer still reading settles the state; a newer generation already replaced it.
          if (Exit.isSuccess(exit) || left || fenced()) return;
          const error = Cause.hasInterrupts(exit.cause)
            ? Error("Snapshot read was cancelled.")
            : Cause.squash(exit.cause);
          self.setState(key, {
            kind: "failed",
            target,
            error:
              typeof error === "object" && error !== null && "message" in error
                ? String(error.message)
                : String(error),
            ...(previous ? { previous } : {}),
          });
        }),
      ),
    );
  });

  async saved(id: string): Promise<TakeoffCapture> {
    takeoffCaptureSchema.shape.id.parse(id);
    const path = join(this.directory, `${id}.json`);
    const stored = storedCapture(
      captureKind(takeoffCaptureSchema).in(this.storage, [`${id}.json`]),
    );
    if (!stored) throw missingCapture(path);
    return stored;
  }

  /** Return exact stored bytes after validating the id, including malformed JSON. */
  async savedText(id: string): Promise<{ path: string; text: string }> {
    takeoffCaptureSchema.shape.id.parse(id);
    const path = join(this.directory, `${id}.json`);
    return { path, text: await readFile(path, "utf8") };
  }

  async list(document?: Address): Promise<TakeoffCapture[]> {
    // ponytail: directory scan for this bounded capture store; index if measured volume demands it.
    const files = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const captures = await Promise.all(
      files
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map((name) => this.saved(name.slice(0, -5))),
    );
    return captures
      .filter((capture) => !document || sameAddress(capture.snapshot.reading.at, document))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }

  async query({
    target,
    capture,
    text,
    saved,
    document,
  }: z.output<typeof product.readings.observations.handle.input>) {
    if (capture) return text ? this.savedText(capture) : this.saved(capture);
    if (saved)
      return (await this.list(document ? addressSchema.parse(document) : undefined)).map(
        ({ snapshot, ...row }) => ({
          ...row,
          document: snapshot.reading.at,
          title: snapshot.world.docName,
        }),
      );
    if (!target) throw Error("Observation status needs an exact open document");
    return this.status(target);
  }

  /** Retain this exact snapshot; the acquiring read owns its scope and freshness fence. */
  async retain(
    snapshot: TakeoffSnapshot,
    provenance: TakeoffCapture["provenance"],
    current?: () => Promise<void>,
  ): Promise<TakeoffCapture> {
    const value = {
      provenance,
      capturedAt: snapshot.reading.observedAt,
      snapshot: takeoffSnapshotSchema.parse(snapshot),
    };
    const id = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const capture = takeoffCaptureSchema.parse({ id, ...value });
    await current?.();
    await writeArtifact(
      this.directory,
      captureKind(takeoffCaptureSchema).in(this.storage, [`${id}.json`]),
      JSON.stringify(capture),
    );
    // Cancellation withdraws the answer, never immutable bytes a peer may already reference.
    await current?.();
    return capture;
  }
}
