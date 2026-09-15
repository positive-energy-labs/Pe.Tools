import { scheduleReadingSchema, type ScheduleReading } from "@pe/agent-contracts";
import { OwnerReads, type OwnerValue } from "@pe/runtime";
import {
  familyCaptureSchema,
  canonicalRouteInput,
  type FamilyCapture,
  type WorkKey,
} from "@pe/agent-contracts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  sameAddress,
  takeoffCaptureSchema,
  takeoffObservationSchema,
  takeoffSnapshotSchema,
  type Address,
  type DocumentRef,
  type TakeoffCapture,
  type TakeoffObservation,
  type TakeoffSnapshot,
} from "@pe/agent-contracts";
import { hostOwnership, productRoot } from "./host-ownership.ts";

const keyOf = (target: DocumentRef) => JSON.stringify([target.session, target.openId]);
const previousOf = (state: TakeoffObservation) =>
  state.kind === "ready" ? state.capture : state.kind === "empty" ? undefined : state.previous;

/** Immutable Takeoffs and Family observations outside authored Work. Immutable files use the host's existing atomic-replace pattern. */
export class TakeoffCaptures {
  private readonly states = new Map<string, TakeoffObservation>();
  private readonly generations = new Map<string, number>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly reads = new OwnerReads();
  private readonly listeners = new Set<(key: string) => void>();
  constructor(private readonly directory: string) {}

  private notify(key: string) {
    for (const listener of this.listeners) listener(key);
  }
  private subscribe(key: string, notify: () => void) {
    const accept = (changed: string) => {
      if (changed === key) notify();
    };
    this.listeners.add(accept);
    return () => {
      this.listeners.delete(accept);
    };
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
  observeFamily(
    scope: WorkKey,
    listener: (value: OwnerValue<FamilyCapture[]>) => void,
    prepare?: () => Promise<unknown>,
  ) {
    const key = `family:${canonicalRouteInput(scope)}`;
    return this.reads.observe(
      key,
      async (signal) => {
        await prepare?.();
        signal.throwIfAborted();
        return this.familyReadings(scope, signal);
      },
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
    this.pending.delete(key);
    this.setState(key, {
      kind: "failed",
      target,
      error: "Model changed; refresh geometry.",
      ...(previous ? { previous } : {}),
    });
  }

  async refresh<A>(
    target: DocumentRef,
    collect: () => Promise<{ result: A; snapshot: TakeoffSnapshot }>,
    current: () => Promise<boolean>,
  ): Promise<{ result: A; capture: TakeoffCapture }> {
    const key = keyOf(target);
    const joined = this.pending.get(key);
    if (joined) return joined as Promise<{ result: A; capture: TakeoffCapture }>;
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    const previous = previousOf(this.read(target));
    this.setState(key, { kind: "reading", target, ...(previous ? { previous } : {}) });
    const run = Promise.resolve().then(async () => {
      try {
        const { result, snapshot } = await collect();
        const assertCurrent = async () => {
          if (this.generations.get(key) !== generation || !(await current()))
            throw Error("Snapshot target or generation changed before publication.");
        };
        await assertCurrent();
        const capture = await this.save(snapshot, { kind: "live", target }, assertCurrent);
        this.setState(key, takeoffObservationSchema.parse({ kind: "ready", target, capture }));
        return { result, capture };
      } catch (error) {
        if (this.generations.get(key) === generation)
          this.setState(key, {
            kind: "failed",
            target,
            error:
              typeof error === "object" && error !== null && "message" in error
                ? String(error.message)
                : String(error),
            ...(previous ? { previous } : {}),
          });
        throw error;
      } finally {
        if (this.generations.get(key) === generation) this.pending.delete(key);
      }
    });
    this.pending.set(key, run);
    return run;
  }

  async saveSchedule(value: Omit<ScheduleReading, "id">): Promise<ScheduleReading> {
    const id = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const reading = scheduleReadingSchema.parse({ ...value, id });
    const directory = join(this.directory, "schedules");
    await mkdir(directory, { recursive: true });
    const temp = join(directory, `${id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(reading), "utf8");
      await rename(temp, join(directory, `${id}.json`));
    } finally {
      await rm(temp, { force: true });
    }
    return reading;
  }
  async schedule(id: string): Promise<ScheduleReading> {
    scheduleReadingSchema.shape.id.parse(id);
    return scheduleReadingSchema.parse(
      JSON.parse(await readFile(join(this.directory, "schedules", `${id}.json`), "utf8")),
    );
  }
  async scheduleWork(workspaceId: string): Promise<ScheduleReading> {
    const names = await readdir(join(this.directory, "schedules"));
    const readings = await Promise.all(
      names
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map((name) => this.schedule(name.slice(0, -5))),
    );
    const latest = readings
      .filter((reading) => reading.workspaceId === workspaceId)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    if (!latest) throw Error("No retained reading for this Schedule Work");
    return latest;
  }
  async saved(id: string): Promise<TakeoffCapture> {
    takeoffCaptureSchema.shape.id.parse(id);
    return takeoffCaptureSchema.parse(
      JSON.parse(await readFile(join(this.directory, `${id}.json`), "utf8")),
    );
  }

  /**
   * The saved capture file's own text, exactly as stored — whitespace and malformed JSON included.
   * Keyed by the same already-validated capture ID `saved()` uses, inside the same owned directory,
   * so no caller can name a path. Never parsed: a JSON.stringify of the parsed capture would be
   * capture data, not disk text.
   */
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

  async saveFamily(
    value: Omit<FamilyCapture, "id">,
    current?: () => Promise<void>,
  ): Promise<FamilyCapture> {
    const id = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const capture = familyCaptureSchema.parse({ id, ...value });
    const directory = join(this.directory, "family");
    await mkdir(directory, { recursive: true });
    const temp = join(directory, `${id}.${randomUUID()}.tmp`);
    const destination = join(directory, `${id}.json`);
    const existed = await stat(destination).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    let published = false;
    try {
      await writeFile(temp, JSON.stringify(capture), "utf8");
      await current?.();
      await rename(temp, destination);
      published = true;
      await current?.();
    } catch (error) {
      if (published && !existed) await rm(destination, { force: true });
      throw error;
    } finally {
      await rm(temp, { force: true });
    }
    this.notify(`family:${canonicalRouteInput(value.key)}`);
    return capture;
  }
  async family(id: string, signal?: AbortSignal): Promise<FamilyCapture> {
    familyCaptureSchema.shape.id.parse(id);
    return familyCaptureSchema.parse(
      JSON.parse(
        await readFile(join(this.directory, "family", `${id}.json`), { encoding: "utf8", signal }),
      ),
    );
  }
  async familyReadings(scope: WorkKey, signal?: AbortSignal): Promise<FamilyCapture[]> {
    const names = await readdir(join(this.directory, "family")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const values = await Promise.all(
      names
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map((name) => this.family(name.slice(0, -5), signal)),
    );
    return values
      .filter((value) => canonicalRouteInput(value.key) === canonicalRouteInput(scope))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }
  private async save(
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
    await mkdir(this.directory, { recursive: true });
    const temp = join(this.directory, `${id}.${randomUUID()}.tmp`);
    const destination = join(this.directory, `${id}.json`);
    const existed = await stat(destination).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    let renamed = false;
    try {
      await writeFile(temp, JSON.stringify(capture), "utf8");
      await current?.();
      await rename(temp, destination);
      renamed = true;
      await current?.();
    } catch (error) {
      await rm(temp, { force: true });
      if (renamed && !existed) await rm(destination, { force: true });
      throw error;
    }
    return capture;
  }
}

let captures: TakeoffCaptures | undefined;
export const hostTakeoffCaptures = () =>
  (captures ??= new TakeoffCaptures(
    join(productRoot(), "state", "host", hostOwnership.serviceName, "takeoff-captures"),
  ));
