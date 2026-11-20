import {
  read as readStoredFile,
  writeState,
  stateKind,
  type StateDirectory,
  type StoredFile,
} from "@pe/host-contracts/kinds";
import { writeArtifact } from "./write-artifact.ts";
import { CaptureKinds } from "./kept-captures.ts";
import { scheduleReadingSchema, type ScheduleReading } from "@pe/agent-contracts";

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
import { createHash } from "node:crypto";
import { z } from "zod";
import { mkdir, readFile, readdir, writeFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  summarizeFamiliesObservation,
  type FamiliesObservation,
  type FamiliesObservationSummary,
  type DocumentRef,
  type AppliedFilter,
  type FamiliesMatrixEnvelope,
} from "@pe/agent-contracts";
export type { FamiliesObservation } from "@pe/agent-contracts";

export const keyOf = (target: DocumentRef) => JSON.stringify([target.session, target.openId]);
const issues = z.array(
  z.looseObject({ code: z.string(), severity: z.string(), message: z.string() }),
);
const parameter = z.looseObject({
  definition: z.looseObject({
    identity: z.looseObject({ key: z.string(), kind: z.string(), name: z.string() }),
  }),
  kind: z.string(),
  scope: z.string(),
  storageType: z.string(),
  formulaState: z.string(),
  valuesPerType: z.record(z.string(), z.string().nullable()),
});
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
  result: z.looseObject({
    families: z.array(
      z.looseObject({
        familyId: z.number(),
        familyUniqueId: z.string(),
        familyName: z.string(),
        typeNames: z.array(z.string()),
        parameters: z.array(parameter),
        issues,
        isPartial: z.boolean(),
        placedInstanceCount: z.number(),
      }),
    ),
    issues,
    page: z
      .object({ totalCount: z.number(), returnedCount: z.number(), isTruncated: z.boolean() })
      .nullish(),
  }),
});
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

type ProgressManifest = { observation: Omit<FamiliesObservation, "result">; records: string[] };
const progressManifestSchema = z.object({
  observation: familiesObservationSchema.omit({ result: true }),
  records: z.array(familiesObservationSchema.shape.id),
});
/**
 * Captures are derived files (ADR 0039 rule 1): one that does not decode is discarded with one
 * notice, and from then on reads as missing, like a capture this host never held.
 */
const captureKind = <T>(schema: z.ZodType<T>) =>
  stateKind({
    schema,
    place: (_parts: readonly string[]) => "Captures",
    segments: (parts: readonly string[]) => parts,
  });
const pointerKind = stateKind({
  schema: z.string(),
  parse: (text) => text,
  place: (_parts: readonly string[]) => "Captures",
  segments: (parts: readonly string[]) => parts,
});
function storedCapture<T>(file: StoredFile<T, "state">): T | null {
  const read = readStoredFile(file);
  return read.kind === "ok" ? read.value : null;
}
const missingCapture = (path: string) =>
  Object.assign(Error(`ENOENT: no readable capture at '${path}'`), { code: "ENOENT" });
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

/** The store's scope closed: this write was refused before it touched a file. */
export class CaptureStoreClosed extends Error {
  readonly _tag = "CaptureStoreClosed";
  constructor() {
    super("The capture store closed with its host; nothing was written.");
  }
}

export class ObservationFiles {
  /** The captures products declare, by kind. The readings below are the platform's own. */
  readonly kept: CaptureKinds;
  private readonly reads = new OwnerReads();
  private readonly familiesSaves = new Map<string, Promise<unknown>>();
  /** Progressive reads this process is running; a stored "reading" revision outside it was interrupted. */
  private readonly liveReads = new Set<string>();
  private readonly listeners = new Set<(key: string) => void>();
  constructor(
    readonly storage: StateDirectory,
    private readonly apsCachePath: string,
    /** The wall stamp on a completed reading; the store's layer supplies `Clock`'s. */
    private readonly now: () => string,
  ) {
    this.kept = new CaptureKinds(storage);
  }
  get directory(): StateDirectory["path"] {
    return this.storage.path;
  }

  /** Close joins admitted writes and refuses later writes before they touch disk. */
  private closing = false;
  private readonly writes = new Set<Promise<unknown>>();
  private admit<T>(write: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new CaptureStoreClosed());
    const running = write();
    this.writes.add(running);
    const forget = () => void this.writes.delete(running);
    running.then(forget, forget);
    return running;
  }

  async close() {
    this.closing = true;
    while (this.writes.size) await Promise.allSettled([...this.writes]);
    this.kept.clear();
    this.familiesSaves.clear();
    this.liveReads.clear();
    this.listeners.clear();
  }

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

  /** The typed route reads the same full observation as the explicit Families command. */
  observeFamilies(
    work: WorkKey,
    listener: (value: OwnerValue<FamiliesObservation | null>) => void,
  ) {
    const key = `families-reading:${workKey(work)}`;
    return this.reads.observe(
      key,
      () => this.displayedFamilies(work),
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

  async saveSchedule(value: Omit<ScheduleReading, "id">): Promise<ScheduleReading> {
    const id = createHash("sha256").update(canonicalRouteInput(value)).digest("hex");
    const reading = scheduleReadingSchema.parse({ ...value, id });
    const directory = join(this.directory, "schedules");
    await writeArtifact(
      directory,
      captureKind(scheduleReadingSchema).in(this.storage, ["schedules", `${id}.json`]),
      JSON.stringify(reading),
    );
    return reading;
  }
  /** A reading without per-target evidence cannot arm a push. */
  async schedule(id: string): Promise<ScheduleReading> {
    scheduleReadingSchema.shape.id.parse(id);
    const parsed = scheduleReadingSchema.safeParse(await this.storedSchedule(id));
    if (!parsed.success)
      throw Error(
        `Schedule reading ${id.slice(0, 12)} lacks the per-target evidence a push needs; re-read the schedule.`,
      );
    return parsed.data;
  }
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
          const stamp = retainedStamp(await this.storedSchedule(id).catch(() => null));
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
    const path = join(this.directory, "schedules", `${id}.json`);
    // JSON null is no reading, so `unknown` loses nothing by reading it as missing.
    const stored = storedCapture(
      captureKind(z.unknown()).in(this.storage, ["schedules", `${id}.json`]),
    );
    if (stored == null) throw missingCapture(path);
    return stored;
  }
  async saveFamily(
    value: Omit<FamilyCapture, "id">,
    current?: () => Promise<void>,
  ): Promise<FamilyCapture> {
    const id = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const capture = familyCaptureSchema.parse({ id, ...value });
    const directory = join(this.directory, "family");
    await current?.();
    await writeArtifact(
      directory,
      captureKind(familyCaptureSchema).in(this.storage, ["family", `${id}.json`]),
      JSON.stringify(capture),
    );
    // Published immutable bytes may already have another consumer; cancellation never deletes them.
    await current?.();
    this.notify(`family:${canonicalRouteInput(value.key)}`);
    return capture;
  }
  async family(id: string, signal?: AbortSignal): Promise<FamilyCapture> {
    familyCaptureSchema.shape.id.parse(id);
    signal?.throwIfAborted();
    const path = join(this.directory, "family", `${id}.json`);
    const stored = storedCapture(
      captureKind(familyCaptureSchema).in(this.storage, ["family", `${id}.json`]),
    );
    if (!stored) throw missingCapture(path);
    return stored;
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
  saveFamilies(...args: Parameters<ObservationFiles["writeFamilies"]>) {
    return this.admit(() => this.writeFamilies(...args));
  }
  private async writeFamilies(
    value: Omit<FamiliesObservation, "id" | "completedAt" | "result"> & { result: unknown },
    expectedLatestId?: string,
  ): Promise<FamiliesObservation> {
    const work = workKey(value.work);
    if (value.progress) this.liveReads.delete(value.progress.runId);
    const completedAt = this.now();
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
      const pointer = join(directory, `${key}.latest`);
      if (expectedLatestId) {
        const latestId = await readFile(pointer, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (latestId !== expectedLatestId)
          throw Error("A newer Families reading replaced the readback basis");
      }
      await writeArtifact(
        directory,
        captureKind(familiesObservationSchema).in(this.storage, ["families", `${id}.json`]),
        JSON.stringify(observation),
      );
      writeState(pointerKind.in(this.storage, ["families", `${key}.latest`]), id);
      await this.displayPointer(value.work, id);
    };
    const pending = (this.familiesSaves.get(key) ?? Promise.resolve())
      .catch((error) => {
        console.error("captures: asynchronous operation failed", error);
        return undefined;
      })
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
    writeState(pointerKind.in(this.storage, ["families", `${key}.display`]), id);
    this.notify(`families-reading:${workKey(work)}`);
  }

  async families(id: string): Promise<FamiliesObservation> {
    return (await this.familiesFile(id)).record;
  }
  private async familiesFile(id: string) {
    familyObservationId(id);
    let path = join(this.directory, "families", `${id}.json`);
    const schema = familiesObservationSchema.refine(
      (record) => record.id === id,
      "Families observation ID does not match its file",
    );
    const whole = storedCapture(captureKind(schema).in(this.storage, ["families", `${id}.json`]));
    if (whole) return { record: whole as FamiliesObservation, path, bytes: await readFile(path) };
    const manifest = await this.progressManifest(id);
    if (!manifest) throw missingCapture(path);
    path = join(this.directory, "families", "progress", "artifacts", `${id}.json`);
    const families = manifest.records.map((hash) => {
      const record = join(this.directory, "families", "records", `${hash}.json`);
      const stored = storedCapture(
        captureKind(z.unknown()).in(this.storage, ["families", "records", `${hash}.json`]),
      );
      if (stored == null) throw missingCapture(record);
      return stored;
    });
    // Composed in memory from a manifest and its records, so a failure here is not a stored file's.
    const bytes = Buffer.from(JSON.stringify(progressReading(manifest, families)));
    const record = schema.parse(JSON.parse(bytes.toString("utf8"))) as FamiliesObservation;
    return { record, path, bytes };
  }

  /** Null when `id` is not a progress revision. A "reading" revision whose run is not live here (host
   *  restart, or an older revision of a settled run) can never finish, so it reads as failed. */
  private async progressManifest(id: string): Promise<ProgressManifest | null> {
    familyObservationId(id);
    const manifest = storedCapture(
      captureKind(progressManifestSchema).in(this.storage, ["families", "progress", `${id}.json`]),
    );
    if (!manifest) return null;
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
  saveFamiliesProgress(...args: Parameters<ObservationFiles["writeFamiliesProgress"]>) {
    return this.admit(() => this.writeFamiliesProgress(...args));
  }
  private async writeFamiliesProgress(
    value: Omit<FamiliesObservation, "id" | "completedAt"> & { progress: FamiliesReadProgress },
  ) {
    if (value.progress.state === "reading") this.liveReads.add(value.progress.runId);
    else this.liveReads.delete(value.progress.runId);
    const folder = join(this.directory, "families");
    const records = await Promise.all(
      value.result.families.map(async (record) => {
        const text = JSON.stringify(record);
        const hash = createHash("sha256").update(text).digest("hex");
        await writeArtifact(
          folder,
          captureKind(z.unknown()).in(this.storage, ["families", "records", `${hash}.json`]),
          text,
        );
        return hash;
      }),
    );
    const { result: _, ...metadata } = value;
    const completedAt = this.now();
    const id = createHash("sha256")
      .update(JSON.stringify([metadata, completedAt, records]))
      .digest("hex");
    const observation = { ...metadata, id, completedAt };
    await writeArtifact(
      folder,
      captureKind(progressManifestSchema).in(this.storage, ["families", "progress", `${id}.json`]),
      JSON.stringify({ observation, records }),
    );
    writeState(
      pointerKind.in(this.storage, [
        "families",
        "progress",
        `${this.progressKey(value.document, value.filter)}.latest`,
      ]),
      id,
    );
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
      readings.push(summarizeFamiliesObservation(await this.families(name.slice(0, -5))));
    }
    return readings.sort(
      (a, b) => b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id),
    );
  }
}
