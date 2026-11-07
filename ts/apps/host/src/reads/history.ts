import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { z } from "zod";
import {
  historyPointSchema,
  historyPoseSchema,
  recordedWorkSchema,
  identityCodecs,
  sameAddress,
  addressSchema,
  type HistoryBinding,
  type HistoryPoint,
  type HistoryPose,
  type Address,
  type DocumentRef,
  type RecordingPoint,
  type RecordingPointReason,
  type Caller,
} from "@pe/agent-contracts";
import { canonicalRouteInput as canonicalJson } from "@pe/agent-contracts";
import type { RecordingReader, RecordingWriter } from "../native-recording.ts";
import { recordingReadSetReferences } from "../recording-points.ts";
import { readSetRecords } from "../input-occurrence.ts";
import { InvalidRead } from "../native-reads.ts";
import { immutable, type Publication, type Publications } from "./evaluator.ts";

const fail = (message: string) =>
  new InvalidRead({ message, status: 409, problem: "history.unavailable" });
export function localHistory(caller: Caller) {
  if (caller.kind === "pea" || (caller.kind === "human" && ["local", "cli"].includes(caller.via))) return;
  throw new InvalidRead({ message: "History is local; sharing a recording needs explicit publication", status: 403, problem: "history.local-only" });
}
const json = (value: unknown) =>
  Schema.decodeUnknownSync(Schema.Json)(JSON.parse(JSON.stringify(value)));
const addressKey = (address: Address) => address.replaceAll("/", "\\").toLowerCase();
const documentId = (address: Address) => {
  const result = identityCodecs.document.encode({ document: addressKey(address) });
  if (!result.ok) throw fail(result.reason);
  return result.value;
};
type Published = {
  binding: HistoryBinding;
  pose: HistoryPose;
  address: Address;
  target: DocumentRef;
};

/** The durable versions are kept BEFORE the synchronous publication commit, never acknowledged by a browser. */
export class History {
  private readonly published = new Map<string, Published>();
  private readonly poses = new Map<string, HistoryPose>();
  private readonly synced = new Set<string>();
  private pending: Promise<unknown> = Promise.resolve();
  private problem: string | null = null;
  constructor(
    private readonly reader: RecordingReader,
    private readonly run: <A>(effect: Effect.Effect<A, InvalidRead>) => Promise<A>,
    private readonly writer?: RecordingWriter,
    private readonly ledger?: Publications,
  ) {}

  /** Only recording is ancillary (K4); live inventory and read-set preparation must already succeed. */
  async record(...args: Parameters<History["keep"]>): Promise<() => void> {
    if (!this.writer || this.writer.capture.truncated()) return () => {};
    try {
      const commit = await this.keep(...args);
      return this.writer.capture.truncated() ? () => {} : commit;
    } catch (error) {
      const at = this.writer.capture.begin();
      const problem = error instanceof InvalidRead ? error.problem : undefined;
      if (at !== null) await this.run(this.writer.capture.stop(at,
        problem === "recording.full" ? "full" : problem === "recording.unsupported" ? "unsupported" : "io", { site: "builtin", op: "history.record" }));
      return () => {};
    }
  }
  private stopped() {
    const stop = this.reader.truncation;
    return stop ? `History stopped at ${new Date(stop.stoppedAt).toISOString()}: ${stop.reason}` : null;
  }

  private async keep(
    subscription: string,
    read: string,
    pose: HistoryPose,
    address: Address,
    target: DocumentRef,
    publication: Publication<unknown>,
  ): Promise<() => void> {
    if (!this.writer || this.writer.capture.truncated()) return () => {};
    const value = publication.value;
    if (!value) throw fail("No Value to record");
    await this.run(recordingReadSetReferences(this.reader, documentId(address), value.inputs));
    const taking = await this.run(
      this.writer.append(
        {
          input: { kind: "publication", key: publication.key },
          scope: canonicalJson([address, pose.instance, read]),
          outputVersion: "publication-1",
        },
        { kind: "observed", value: json(publication) },
      ),
    );
    const kept: Published = immutable({
      address,
      target: { session: target.session, openId: target.openId },
      pose,
      binding: {
        subscription,
        instance: pose.instance,
        read,
        key: publication.key,
        version: publication.version,
        evaluation: value.evaluation,
        inputs: value.inputs,
        taking: taking.id,
        state: publication.state === "current" ? "current" : "refresh-needed",
        reason: publication.reason,
      },
    });
    return () => {
      this.published.set(subscription, kept);
      this.poses.set(canonicalJson([addressKey(address), pose.instance]), pose);
      const basis = canonicalJson([
        addressKey(address),
        value.trace.filter((t) => t.name === "document-mark").map((t) => t.hash),
      ]);
      if (!this.synced.has(basis)) {
        this.synced.add(basis);
        this.enqueue(address, { kind: "synced" });
      }
    };
  }

  pose(address: Address, raw: unknown) {
    const pose = historyPoseSchema.parse(raw);
    if (
      ![...this.published.values()].some(
        (p) => sameAddress(p.address, address) && p.pose.instance === pose.instance,
      )
    )
      throw fail("No host publication for this Page");
    this.poses.set(canonicalJson([addressKey(address), pose.instance]), immutable(pose));
  }

  /** Snapshot the ledger now, before queued IO can observe a later publication. */
  private snapshot(address: Address, reason: RecordingPointReason): RecordingPoint {
    if (!this.writer || this.writer.capture.truncated())
      throw fail("History storage is full or unavailable");
    const slots = [...this.published.values()].filter((p) => sameAddress(p.address, address));
    if (!slots.length) throw fail("No published Values for this document");
    const end = this.writer.takingCursor();
    return {
      version: 1,
      id: randomUUID() as RecordingPoint["id"],
      document: documentId(address),
      reason,
      at: Date.now(),
      identity: this.reader.identity,
      takingRange: { start: 0, end },
      bindings: [],
      history: json({
        address,
        target: slots.at(-1)!.target,
        poses: [...new Set(slots.map((p) => p.pose.instance))].map(
          (instance) => this.poses.get(canonicalJson([addressKey(address), instance]))!,
        ),
        publications: slots.map((p) => {
          const latest = this.ledger?.publication(p.binding.subscription);
          return {
            ...p.binding,
            ...(latest ? { state: latest.state, reason: latest.reason } : {}),
          };
        }),
      }),
    };
  }
  capture(address: Address, reason: RecordingPointReason = { kind: "captured" }) {
    const point = this.snapshot(address, reason);
    const write = this.pending.then(async () => {
      // Every root must still be complete; an ancillary input capture failure cannot mint a point.
      for (const binding of historyPointSchema.parse(point).history.publications)
        await this.run(readSetRecords(this.reader, binding.inputs));
      if (this.writer!.capture.truncated()) throw fail(this.stopped()!);
      await this.run(this.writer!.points.keep(point));
      this.problem = null;
      return historyPointSchema.parse(point);
    });
    this.pending = write.catch((error: unknown) => {
      this.problem = String(error);
    });
    return write;
  }
  enqueue(address: Address, reason: RecordingPointReason) {
    try {
      void this.capture(address, reason).catch(() => {});
    } catch (error) {
      this.problem = String(error);
    }
  }
  afterWrite(target: DocumentRef, receipt: string) {
    for (const address of new Set(
      [...this.published.values()]
        .filter((p) => canonicalJson(p.target) === canonicalJson(target))
        .map((p) => p.address),
    ))
      this.enqueue(address, { kind: "afterWrite", receipt });
  }
  async list(address: Address) {
    await this.pending;
    const points: HistoryPoint[] = [];
    for (const id of this.reader.points.ids()) {
      const point = await this.run(this.reader.points.get(id));
      if (point.document === documentId(address) && point.history)
        points.push(historyPointSchema.parse(point));
    }
    const unavailable: { point: string; instance: string; reason: string }[] = [];
    for (const point of points) for (const pose of point.history.poses) {
      try {
        const bindings = new Map(point.history.publications.filter(b => b.instance === pose.instance).map(b => [canonicalJson([b.read, b.key]), b]));
        if (!bindings.size) throw fail("This route was never published at this point");
        for (const binding of bindings.values()) await this.publication(point.id, pose.instance, binding.read, binding.key);
      } catch (error) {
        unavailable.push({ point: point.id, instance: pose.instance, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { points: points.sort((a, b) => b.at - a.at), unavailable, problem: this.stopped() ?? this.problem };
  }
  async get(id: string) {
    await this.pending;
    return immutable(historyPointSchema.parse(await this.run(this.reader.points.get(id))));
  }
  async publication(id: string, instance: string, read: string, key?: string) {
    const point = await this.get(id);
    const candidates = point.history.publications.filter(
      (b) => b.instance === instance && b.read === read && (!key || b.key === key),
    );
    // Multiple subscriptions may publish the very same version. Distinct versions remain ambiguous.
    const bindings = [
      ...new Map(
        candidates.map((b) => [canonicalJson([b.key, b.version, b.evaluation]), b]),
      ).values(),
    ];
    if (bindings.length !== 1)
      throw fail(
        bindings.length
          ? "Ambiguous pane at this point"
          : "This pane was never published at this point",
      );
    const binding = bindings[0]!;
    const references = await this.run(
      recordingReadSetReferences(
        this.reader,
        point.document as RecordingPoint["document"],
        binding.inputs,
      ),
    );
    for (const taking of [...references.ids, binding.taking]) {
      let inRange = false;
      for (let cursor = point.takingRange.start; cursor < point.takingRange.end; cursor++)
        if (this.reader.takingAt(cursor)?.id === taking) {
          inRange = true;
          break;
        }
      if (!inRange) throw fail("Published Value lies outside this point's taking range");
    }
    const taking = this.reader.taking(binding.taking);
    if (
      !taking ||
      taking.input.kind !== "publication" ||
      taking.input.key !== binding.key
    )
      throw fail("Missing published Value");
    const scope = z.tuple([addressSchema, z.string(), z.string()]).parse(JSON.parse(taking.scope));
    if (!sameAddress(scope[0], point.history.address) || scope[1] !== instance || scope[2] !== read)
      throw fail("Published Value belongs to another document or pane");
    const raw = await this.run(this.reader.observation(taking));
    const publication = z
      .object({
        key: z.string(),
        version: z.number(),
        value: z.object({ evaluation: z.string(), inputs: z.string() }),
      })
      .passthrough()
      .parse(raw);
    if (
      publication.key !== binding.key ||
      publication.version !== binding.version ||
      publication.value.evaluation !== binding.evaluation ||
      publication.value.inputs !== binding.inputs
    )
      throw fail("Published Value reference differs from its point");
    await this.run(readSetRecords(this.reader, binding.inputs));
    const value = raw as Record<string, Schema.Json>;
    return {
      ...value,
      state: binding.state,
      reason: binding.reason,
      value: {
        ...(value.value as Record<string, Schema.Json>),
        freshness: binding.state === "current" ? "current" : "refresh-needed",
      },
    };
  }
  async work(id: string) {
    const point = await this.get(id);
    const found = new Map<string, z.infer<typeof recordedWorkSchema>>();
    const ambiguous = new Set<string>();
    for (const binding of [
      ...new Map(point.history.publications.map((b) => [b.inputs, b])).values(),
    ]) {
      const records = await this.run(readSetRecords(this.reader, binding.inputs));
      for (const record of records)
        for (const input of record.inputs) {
          if (input.input.kind !== "work") continue;
          const taking = this.reader.taking(input.takingId);
          if (!taking) throw fail("Missing recorded Work");
          const value = recordedWorkSchema.safeParse(
            await this.run(this.reader.observation(taking)),
          );
          if (!value.success) continue;
          const key = canonicalJson(value.data.handle.key);
          if (found.has(key) && canonicalJson(found.get(key)) !== canonicalJson(value.data))
            ambiguous.add(key);
          found.set(key, value.data);
        }
    }
    return [...found.entries()].filter(([key]) => !ambiguous.has(key)).map(([, value]) => value);
  }
  async close() {
    await this.pending;
  }
}
