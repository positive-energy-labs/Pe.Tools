import { scheduleReadingSchema, type ScheduleReading } from "@pe/agent-contracts";

/** The one sentence a surface shows for a retained reading that cannot arm a push. */
export class StaleScheduleReading extends Error {
  constructor(readonly id: string) {
    super(
      `Schedule reading ${id.slice(0, 12)} lacks the per-target evidence a push needs; re-read the schedule.`,
    );
  }
}
/** Enough of a retained reading to choose the latest one per subject without trusting the rest. */
function retainedStamp(value: unknown): { workspaceId: string; capturedAt: string } | null {
  const v = value as { workspaceId?: unknown; capturedAt?: unknown } | null;
  return typeof v?.workspaceId === "string" && typeof v.capturedAt === "string"
    ? { workspaceId: v.workspaceId, capturedAt: v.capturedAt }
    : null;
}
import { OwnerReads, type OwnerValue } from "@pe/runtime";
import {
  familyCaptureSchema,
  canonicalRouteInput,
  workKey,
  workKeySchema,
  familiesReadProgressSchema,
  type FamiliesReadProgress,
  type FamilyCapture,
  type HistoryRow,
  type WorkKey,
} from "@pe/agent-contracts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { RevitMatrixLoadedFamilies } from "@pe/host-contracts/generated";
import { productPathNames } from "@pe/host-contracts/contracts";
import { mkdir, readFile, readdir, rename, writeFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  sameAddress,
  takeoffCaptureSchema,
  takeoffObservationSchema,
  takeoffSnapshotSchema,
  type Address,
  type DocumentRef,
  type AppliedFilter,
  type FamiliesMatrixEnvelope,
  type TakeoffCapture,
  type TakeoffObservation,
  type TakeoffSnapshot,
} from "@pe/agent-contracts";
import { hostOwnership, productRoot } from "./host-ownership.ts";

const keyOf = (target: DocumentRef) => JSON.stringify([target.session, target.openId]);
const previousOf = (state: TakeoffObservation) =>
  state.kind === "ready" ? state.capture : state.kind === "empty" ? undefined : state.previous;

const familiesObservationSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  work: workKeySchema.refine((work) => work.route === "families"),
  document: z.object({ session: z.string().min(1), openId: z.string().min(1) }),
  documentTitle: z.string().min(1).optional(),
  filter: z.object({
    categoryNames: z.array(z.string()),
    familyNames: z.array(z.string()),
    placementScope: z.enum(["AllLoaded", "PlacedOnly", "UnplacedOnly"]),
  }),
  capturedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  progress: familiesReadProgressSchema.optional(),
  readback: z
    .object({
      sourceId: z.string().regex(/^[a-f0-9]{64}$/),
      verifiedFamilies: z.array(z.object({ name: z.string().min(1), at: z.iso.datetime() })),
    })
    .optional(),
  result: z
    .object({
      families: z.array(
        z
          .object({
            familyId: z.number(),
            familyUniqueId: z.string(),
            familyName: z.string(),
            typeNames: z.array(z.string()),
            parameters: z.array(
              z
                .object({
                  definition: z
                    .object({
                      identity: z
                        .object({ key: z.string(), kind: z.string(), name: z.string() })
                        .passthrough(),
                    })
                    .passthrough(),
                  kind: z.string(),
                  scope: z.string(),
                  storageType: z.string(),
                  formulaState: z.string(),
                  valuesPerType: z.record(z.string(), z.string().nullable()),
                })
                .passthrough(),
            ),
            issues: z.array(
              z
                .object({ code: z.string(), severity: z.string(), message: z.string() })
                .passthrough(),
            ),
            isPartial: z.boolean(),
            placedInstanceCount: z.number(),
          })
          .passthrough(),
      ),
      issues: z.array(
        z.object({ code: z.string(), severity: z.string(), message: z.string() }).passthrough(),
      ),
      page: z
        .object({ totalCount: z.number(), returnedCount: z.number(), isTruncated: z.boolean() })
        .nullable()
        .optional(),
    })
    .passthrough(),
});
export type FamiliesObservation = {
  id: string;
  work: WorkKey;
  document: DocumentRef;
  documentTitle?: string;
  filter: AppliedFilter;
  capturedAt: string;
  completedAt: string;
  progress?: FamiliesReadProgress;
  /** Targeted loaded-project reads after apply; all other families retain capturedAt evidence. */
  readback?: { sourceId: string; verifiedFamilies: { name: string; at: string }[] };
  result: RevitMatrixLoadedFamilies.Res.Response;
};

export type FamiliesObservationSummary = Omit<FamiliesObservation, "result"> & {
  familyCount: number;
  typeCount: number;
  issueCount: number;
};

type JsonArtifactReference = {
  path: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  format: "json";
};

type ApsParameterCacheReference =
  | {
      source: "parameters-service-cache";
      status: "ready";
      modifiedAt: string;
      artifact: JsonArtifactReference;
    }
  | {
      source: "parameters-service-cache";
      status: "missing" | "malformed";
      reason: string;
    };

const artifactOf = (path: string, url: string, bytes: Buffer): JsonArtifactReference => ({
  path: resolve(path),
  url,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  sizeBytes: bytes.length,
  format: "json",
});

const familyObservationId = (id: string) => familiesObservationSchema.shape.id.parse(id);

/** Immutable Takeoffs and Family observations outside authored Work. Immutable files use the host's existing atomic-replace pattern. */
type ProgressManifest = { observation: Omit<FamiliesObservation, "result">; records: string[] };
/** A progress revision in the completed-reading envelope; `families` may be empty for a parts reply. */
const progressReading = (manifest: ProgressManifest, families: unknown[]) => ({
  ...manifest.observation,
  result: {
    families,
    issues: [],
    page: {
      totalCount: manifest.observation.progress?.total ?? manifest.records.length,
      returnedCount: manifest.records.length,
      isTruncated: false,
    },
  },
});

export class TakeoffCaptures {
  private readonly states = new Map<string, TakeoffObservation>();
  private readonly generations = new Map<string, number>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly reads = new OwnerReads();
  private readonly familiesSaves = new Map<string, Promise<unknown>>();
  private readonly familyRecordFiles = new WeakMap<object, Promise<string>>();
  /** Progressive reads this process is running; a stored "reading" revision outside it was interrupted. */
  private readonly liveReads = new Set<string>();
  private readonly listeners = new Set<(key: string) => void>();
  constructor(
    readonly directory: string,
    private readonly apsCachePath = join(
      productRoot(),
      productPathNames.stateDirectoryName,
      productPathNames.globalDirectoryName,
      "parameters-service-cache.json",
    ),
  ) {}

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

  /**
   * The families matrix Reading's envelope (MAP ruling 3): the last completed matrix read of this
   * document over this filter, as its taken-at and its body's id. The body stays on disk, fetched
   * by id over RPC; a completed read (`saveFamilies`) publishes a new envelope.
   */
  observeFamiliesMatrix(
    target: DocumentRef,
    filter: AppliedFilter,
    listener: (value: OwnerValue<FamiliesMatrixEnvelope>) => void,
  ) {
    const key = `families-matrix:${keyOf(target)}`;
    return this.reads.observe(
      `${key}:${canonicalRouteInput(filter)}`,
      async () => {
        const progress = await this.familiesProgress(target, filter);
        if (progress)
          return {
            reading: {
              at: progress.work.binding === "address" ? progress.work.target : null,
              version: null,
              observedAt: progress.capturedAt,
            },
            bodyVersion: progress.id,
          };
        const latest = (await this.familiesReadings())
          .filter(
            (read) =>
              keyOf(read.document) === keyOf(target) &&
              canonicalRouteInput(read.filter) === canonicalRouteInput(filter),
          )
          .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
        return latest
          ? {
              reading: {
                at: latest.work.binding === "address" ? latest.work.target : null,
                version: null,
                // A readback re-read what the apply touched, after the apply's own change.
                observedAt: latest.readback ? latest.completedAt : latest.capturedAt,
              },
              bodyVersion: latest.id,
            }
          : null;
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
  /**
   * A retained reading that no longer meets the reading contract (one captured before per-target
   * cell evidence) refuses; nothing migrates or defaults it, so it can never arm a push.
   */
  async schedule(id: string): Promise<ScheduleReading> {
    scheduleReadingSchema.shape.id.parse(id);
    const parsed = scheduleReadingSchema.safeParse(await this.storedSchedule(id));
    if (!parsed.success) throw new StaleScheduleReading(id);
    return parsed.data;
  }
  /** The latest reading of one Work subject; other subjects' readings are never parsed as readings. */
  /** Every retained reading of one Work subject, newest first: its History (ruling 57). */
  async scheduleHistory(workspaceId: string): Promise<HistoryRow[]> {
    const names = await readdir(join(this.directory, "schedules")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const stamps = await Promise.all(
      names
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map(async (name) => {
          const id = name.slice(0, -5);
          const stamp = retainedStamp(await this.storedSchedule(id));
          return stamp?.workspaceId === workspaceId
            ? [{ id, at: stamp.capturedAt, label: "grid read" }]
            : [];
        }),
    );
    return stamps.flat().sort((a, b) => b.at.localeCompare(a.at));
  }
  /** The Work's latest retained reading; null when the host holds none (a catalog pick, unread). */
  async scheduleWork(workspaceId: string): Promise<ScheduleReading | null> {
    const latest = (await this.scheduleHistory(workspaceId))[0];
    return latest ? this.schedule(latest.id) : null;
  }
  private async storedSchedule(id: string): Promise<unknown> {
    return JSON.parse(await readFile(join(this.directory, "schedules", `${id}.json`), "utf8"));
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
  async savedFamilyText(id: string): Promise<{ path: string; text: string }> {
    familyCaptureSchema.shape.id.parse(id);
    const path = join(this.directory, "family", `${id}.json`);
    return { path, text: await readFile(path, "utf8") };
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
  /** One latest pointer per durable Families Work; full observations remain immutable. */
  async saveFamilies(
    value: Omit<FamiliesObservation, "id" | "completedAt" | "result"> & { result: unknown },
    expectedLatestId?: string,
  ): Promise<FamiliesObservation> {
    const work = workKey(value.work);
    if (value.progress) this.liveReads.delete(value.progress.runId);
    const completedAt = new Date().toISOString();
    const id = createHash("sha256")
      .update(JSON.stringify({ ...value, completedAt }))
      .digest("hex");
    const observation = familiesObservationSchema.parse({
      ...value,
      id,
      completedAt,
    }) as FamiliesObservation;
    const key = createHash("sha256").update(work).digest("hex");
    const directory = join(this.directory, "families");
    const save = async () => {
      await mkdir(directory, { recursive: true });
      const snapshot = join(directory, `${id}.json`);
      const pointer = join(directory, `${key}.latest`);
      if (expectedLatestId) {
        const latestId = await readFile(pointer, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (latestId !== expectedLatestId)
          throw Error("A newer Families reading replaced the readback basis");
      }
      const tempSnapshot = join(directory, `${id}.${randomUUID()}.tmp`);
      const tempPointer = join(directory, `${key}.${randomUUID()}.tmp`);
      try {
        await writeFile(tempSnapshot, JSON.stringify(observation), "utf8");
        await rename(tempSnapshot, snapshot);
        await writeFile(tempPointer, id, "utf8");
        await rename(tempPointer, pointer);
        await this.displayPointer(value.work, id);
      } finally {
        await rm(tempSnapshot, { force: true });
        await rm(tempPointer, { force: true });
      }
    };
    const pending = (this.familiesSaves.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(save);
    this.familiesSaves.set(key, pending);
    try {
      await pending;
    } finally {
      if (this.familiesSaves.get(key) === pending) this.familiesSaves.delete(key);
    }
    this.notify(`families-matrix:${keyOf(value.document)}`);
    return observation;
  }
  async saveFamiliesReadback(
    sourceId: string,
    document: DocumentRef,
    familyNames: readonly string[],
    at: string,
    result: unknown,
  ): Promise<FamiliesObservation> {
    const source = await this.families(sourceId);
    if (source.document.session !== document.session || source.document.openId !== document.openId)
      throw Error("Families readback belongs to another document");
    const verified = familiesObservationSchema.shape.result.parse(result);
    const names = new Set(familyNames);
    if (
      !names.size ||
      verified.page?.isTruncated ||
      verified.issues.some((issue) => issue.severity === "Error") ||
      verified.families.some(
        (family) =>
          !names.has(family.familyName) ||
          family.isPartial ||
          family.issues.some((issue) => issue.severity === "Error") ||
          !source.result.families.some((before) => before.familyName === family.familyName),
      ) ||
      verified.families.length !== names.size ||
      [...names].some((name) => !verified.families.some((family) => family.familyName === name))
    )
      throw Error("Targeted Families readback did not return every applied family completely");
    const byName = new Map(verified.families.map((family) => [family.familyName, family]));
    const priorVerified = new Map(
      source.readback?.verifiedFamilies.map((row) => [row.name, row.at]),
    );
    for (const name of names) priorVerified.set(name, at);
    return this.saveFamilies(
      {
        work: source.work,
        document,
        ...(source.documentTitle ? { documentTitle: source.documentTitle } : {}),
        filter: source.filter,
        capturedAt: source.capturedAt,
        readback: {
          sourceId,
          verifiedFamilies: [...priorVerified].map(([name, verifiedAt]) => ({
            name,
            at: verifiedAt,
          })),
        },
        result: {
          ...source.result,
          families: source.result.families.map((family) => byName.get(family.familyName) ?? family),
          issues: [
            ...source.result.issues.filter(
              (issue) => !issue.familyName || !names.has(issue.familyName),
            ),
            ...verified.issues,
          ],
        },
      },
      sourceId,
    );
  }
  async latestFamilies(work: WorkKey): Promise<FamiliesObservation | null> {
    const key = createHash("sha256").update(workKey(work)).digest("hex");
    const directory = join(this.directory, "families");
    const id = await readFile(join(directory, `${key}.latest`), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (!id) return null;
    const record = await this.families(id);
    if (workKey(record.work) !== workKey(work))
      throw Error("Families observation Work does not match its latest pointer");
    return record;
  }
  /** Display can restore partial work; planning uses the completed latestFamilies baseline. */
  async displayedFamilies(work: WorkKey): Promise<FamiliesObservation | null> {
    const key = createHash("sha256").update(workKey(work)).digest("hex");
    const id = await readFile(join(this.directory, "families", `${key}.display`), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (!id) return this.latestFamilies(work);
    const record = await this.families(id);
    if (workKey(record.work) !== workKey(work))
      throw Error("Families display belongs to another Work");
    return record;
  }

  private async displayPointer(work: WorkKey, id: string) {
    const key = createHash("sha256").update(workKey(work)).digest("hex");
    const path = join(this.directory, "families", `${key}.display`);
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, id);
    await rename(temp, path);
  }

  async families(id: string): Promise<FamiliesObservation> {
    return (await this.familiesFile(id)).record;
  }
  private async familiesFile(id: string) {
    familyObservationId(id);
    let path = join(this.directory, "families", `${id}.json`);
    const bytes = await readFile(path).catch(async (error: NodeJS.ErrnoException) => {
      const manifest = error.code === "ENOENT" ? await this.progressManifest(id) : null;
      if (!manifest) throw error;
      path = join(this.directory, "families", "progress", "artifacts", `${id}.json`);
      const families = await Promise.all(
        manifest.records.map(async (hash) =>
          JSON.parse(
            await readFile(join(this.directory, "families", "records", `${hash}.json`), "utf8"),
          ),
        ),
      );
      return Buffer.from(JSON.stringify(progressReading(manifest, families)));
    });
    const record = familiesObservationSchema.parse(
      JSON.parse(bytes.toString("utf8")),
    ) as FamiliesObservation;
    if (record.id !== id) throw Error("Families observation ID does not match its file");
    return { record, path, bytes };
  }

  /** Null when `id` is not a progress revision. A "reading" revision whose run is not live here (host
   *  restart, or an older revision of a settled run) can never finish, so it reads as failed. */
  private async progressManifest(id: string): Promise<ProgressManifest | null> {
    familyObservationId(id);
    const raw = await readFile(
      join(this.directory, "families", "progress", `${id}.json`),
      "utf8",
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (raw === null) return null;
    const manifest = JSON.parse(raw) as ProgressManifest;
    for (const hash of manifest.records) familyObservationId(hash);
    const progress = manifest.observation.progress;
    if (progress?.state === "reading" && !this.liveReads.has(progress.runId))
      manifest.observation.progress = {
        ...progress,
        state: "failed",
        message: "This read is no longer running; read again.",
      };
    return manifest;
  }

  private progressKey(target: DocumentRef, filter: AppliedFilter) {
    return createHash("sha256")
      .update(canonicalRouteInput([target, filter]))
      .digest("hex");
  }

  /** Per-family blobs are written once. Tiny immutable manifests project each revision for the existing envelope. */
  async saveFamiliesProgress(
    value: Omit<FamiliesObservation, "id" | "completedAt"> & { progress: FamiliesReadProgress },
  ) {
    if (value.progress.state === "reading") this.liveReads.add(value.progress.runId);
    else this.liveReads.delete(value.progress.runId);
    const folder = join(this.directory, "families");
    await mkdir(join(folder, "records"), { recursive: true });
    await mkdir(join(folder, "progress"), { recursive: true });
    const records = await Promise.all(
      value.result.families.map(async (record) => {
        const known = this.familyRecordFiles.get(record);
        if (known) return known;
        const saving = (async () => {
          const text = JSON.stringify(record);
          const hash = createHash("sha256").update(text).digest("hex");
          // Content-addressed: a rename over an existing blob writes identical bytes.
          const path = join(folder, "records", `${hash}.json`);
          const temp = `${path}.${randomUUID()}.tmp`;
          await writeFile(temp, text);
          await rename(temp, path);
          return hash;
        })();
        this.familyRecordFiles.set(record, saving);
        return saving;
      }),
    );
    const { result: _, ...metadata } = value;
    const completedAt = new Date().toISOString();
    const id = createHash("sha256")
      .update(JSON.stringify([metadata, completedAt, records]))
      .digest("hex");
    const observation = { ...metadata, id, completedAt };
    await writeFile(
      join(folder, "progress", `${id}.json`),
      JSON.stringify({ observation, records }),
    );
    const pointer = join(
      folder,
      "progress",
      `${this.progressKey(value.document, value.filter)}.latest`,
    );
    const temp = `${pointer}.${randomUUID()}.tmp`;
    await writeFile(temp, id);
    await rename(temp, pointer);
    await this.displayPointer(value.work, id);
    this.notify(`families-matrix:${keyOf(value.document)}`);
    return { ...observation, result: value.result };
  }

  private async familiesProgress(target: DocumentRef, filter: AppliedFilter) {
    const pointer = join(
      this.directory,
      "families",
      "progress",
      `${this.progressKey(target, filter)}.latest`,
    );
    const id = await readFile(pointer, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    return id ? ((await this.progressManifest(id))?.observation ?? null) : null;
  }

  async clearFamiliesProgress(target: DocumentRef, filter: AppliedFilter) {
    await rm(
      join(this.directory, "families", "progress", `${this.progressKey(target, filter)}.latest`),
      { force: true },
    );
    this.notify(`families-matrix:${keyOf(target)}`);
  }
  async familiesArtifact(id: string): Promise<Buffer> {
    return (await this.familiesFile(id)).bytes;
  }
  /** Display revisions transfer only newly completed immutable family records. */
  async familiesParts(id: string) {
    const manifest = await this.progressManifest(id);
    if (!manifest) return { reading: await this.families(id), records: null };
    return {
      reading: familiesObservationSchema.parse(progressReading(manifest, [])),
      records: manifest.records,
    };
  }
  async familyRecord(hash: string) {
    familyObservationId(hash);
    return readFile(join(this.directory, "families", "records", `${hash}.json`));
  }
  async familiesReference(id: string) {
    const { record, path, bytes } = await this.familiesFile(id);
    if (record.progress && record.progress.state !== "complete") {
      // Materialize a full artifact only when requested, not on every incremental display revision.
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    }
    const { result, ...reading } = record;
    return {
      ...reading,
      familyCount: result.families.length,
      typeCount: result.families.reduce((count, family) => count + family.typeNames.length, 0),
      issueCount: result.issues.length,
      familyIssueCount: result.families.reduce((count, family) => count + family.issues.length, 0),
      partialFamilyCount: result.families.filter((family) => family.isPartial).length,
      page: result.page ?? null,
      valueSemantics:
        "valuesPerType are Revit-formatted display strings: null and empty string differ, and measured values may be rounded. This retained reading is evidence, not edit authority; use an explicit Family capture for exact native model values and dependencies.",
      artifact: artifactOf(path, `/families/readings?id=${id}&format=artifact`, bytes),
      apsParametersCache: (await this.apsParameterCache(id)).reference,
    };
  }
  private async apsParameterCache(
    id: string,
  ): Promise<{ reference: ApsParameterCacheReference; bytes: Buffer | null }> {
    const source = "parameters-service-cache" as const;
    const bytes = await readFile(this.apsCachePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!bytes)
      return {
        reference: { source, status: "missing", reason: "No saved APS parameter cache exists." },
        bytes: null,
      };
    try {
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || !Array.isArray(Reflect.get(parsed, "Results")))
        throw Error("Results array missing");
    } catch {
      return {
        reference: {
          source,
          status: "malformed",
          reason: "Saved APS parameter cache is not valid Parameters Service JSON.",
        },
        bytes: null,
      };
    }
    const modifiedAt = (await stat(this.apsCachePath)).mtime.toISOString();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      reference: {
        source,
        status: "ready",
        modifiedAt,
        artifact: artifactOf(
          this.apsCachePath,
          `/families/readings?id=${id}&format=parameters-cache&sha256=${sha256}`,
          bytes,
        ),
      },
      bytes,
    };
  }
  async apsParameterCacheArtifact(id: string, expectedSha256: string): Promise<Buffer> {
    await this.families(id);
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw Error("APS cache SHA-256 required");
    const { reference: cache, bytes } = await this.apsParameterCache(id);
    if (cache.status !== "ready") throw Error(cache.reason);
    if (!bytes) throw Error("APS parameter cache bytes are unavailable");
    if (cache.artifact.sha256 !== expectedSha256)
      throw Error("APS parameter cache changed since this reference; request a fresh reference.");
    return bytes;
  }
  async familiesReadings(): Promise<FamiliesObservationSummary[]> {
    const directory = join(this.directory, "families");
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const readings: FamiliesObservationSummary[] = [];
    // ponytail: scan immutable files until a measured archive size warrants a metadata index.
    for (const name of names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      const { result, ...reading } = await this.families(name.slice(0, -5));
      readings.push({
        ...reading,
        familyCount: result.families.length,
        typeCount: result.families.reduce((count, family) => count + family.typeNames.length, 0),
        issueCount: result.issues.length,
      });
    }
    return readings.sort(
      (a, b) => b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id),
    );
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
