/** ADR0031 epochs: metadata over the existing recording and consumption graph, never a journal. */
import { createHash, randomUUID } from "node:crypto";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import {
  addressSchema,
  sameAddress,
  recordingPointSchema,
  workHandleSchema,
  workKey,
  recordingConsumerSchema,
  acceptedReadingSchema,
  type AcceptedReading,
  type RecordingPoint,
  type RecordingPointId,
  type RecordingPointReason,
  type RecordingConsumer,
} from "@pe/agent-contracts";
import { identityCodecs } from "../../../packages/agent-contracts/src/route-kernel-codecs.ts";
import type { IdentityId } from "../../../packages/agent-contracts/src/route-kernel-page.ts";
import { canonicalJson } from "@pe/host-internal/native-read";
import { hostSessionScopeSchema } from "@pe/host-contracts/operation-types";
import {
  defaultReadSetLimits,
  readSetRecords,
  HostInputReadSets,
  type InputConsumption,
  type ReadSetId,
} from "./input-occurrence.ts";
import type { ConsumerRecipe, RecordingReader, RecordingWriter } from "./native-recording.ts";
import { InvalidRead } from "./native-reads.ts";
import type { bodyReceipts } from "./body-receipts.ts";

type Document = IdentityId<"document">;
type ReadSets = HostInputReadSets["Service"];
const refuse = (problem: string, message: string) =>
  new InvalidRead({ message, status: 409, problem: `recording.${problem}` });
const bindingKey = (binding: RecordingConsumer) =>
  canonicalJson([binding.instance, binding.reading, binding.argsHash]);
const createHashForVersions = (versions: readonly string[]) =>
  createHash("sha256").update(canonicalJson(versions)).digest("hex");
/** One ACK's verified immutable bytes; no payload retention and no proof shared across ACKs. */
class VerifiedObservations extends Context.Service<VerifiedObservations, Set<string>>()(
  "pe/AcceptedObservationIntegrity",
) {}

export interface RecordingPoints {
  readonly list: (document: Document) => Effect.Effect<readonly RecordingPoint[], InvalidRead>;
  readonly get: (
    document: Document,
    point: RecordingPointId,
  ) => Effect.Effect<RecordingPoint, InvalidRead>;
  readonly open: (
    document: Document,
    point: RecordingPointId,
    consumer: RecordingConsumer,
    recipe: ConsumerRecipe,
  ) => Effect.Effect<InputConsumption, InvalidRead>;
}

/** Host integration only. Implement from the final BODY acceptance owner, never request fields,
 * a stream envelope, the last observed value, or a bare read-set selector. */
export interface AcceptedFrameEvidence {
  readonly document: Document;
  readonly readSetId: ReadSetId;
  readonly bodyVersion: string;
  readonly identity: RecordingReader["identity"];
  readonly consumer: RecordingConsumer;
}
export interface AcceptedFrameVerifier {
  readonly verify: (receipt: string) => Effect.Effect<AcceptedFrameEvidence, InvalidRead>;
}
declare const verified: unique symbol;
/** Only this kernel's verifier can issue one. A structural cast grants no capability. */
export type VerifiedAcceptedFrame = { readonly [verified]: "VerifiedAcceptedFrame" };

const documentRow = Schema.Struct({
  address: Schema.String,
  session: Schema.String,
  openId: Schema.String,
});

/** Validate all transitive references through the SAME loader replay uses; prove the document
 * from its recorded inventory row, rather than trusting a request's claimed document. */
export const recordingReadSetReferences = Effect.fn("RecordingPoints.references")(function* (
  reader: RecordingReader,
  document: Document,
  id: string,
) {
  const decoded = identityCodecs.document.decode(document);
  if (!decoded.ok) return yield* refuse("scope", "Invalid declared document identity");
  const wanted = addressSchema.safeParse(identityCodecs.document.parts(decoded.value).document);
  if (!wanted.success) return yield* refuse("scope", "Document has no recorded Address authority");
  const records = yield* readSetRecords(reader, id);
  const integrity = yield* Effect.serviceOption(VerifiedObservations);
  const verified = integrity._tag === "Some" ? integrity.value : undefined;
  const ids = new Set<string>();
  const documents = new Map<string, { session: string; openId: string }>();
  let workAuthority = false;
  let metadata = 0;
  for (const record of records) {
    metadata += Buffer.byteLength(JSON.stringify(record));
    for (const entry of record.inputs) ids.add(entry.takingId);
    for (const taking of Object.values(record.takingLinks)) ids.add(taking);
  }
  for (const id of ids) {
    const taking = reader.taking(id);
    if (!taking) return yield* refuse("miss", "Point references a missing taking");
    // Verify observation bytes even for inputs the selected body might not read on this replay.
    if (taking.outcome.kind === "answered" || taking.outcome.kind === "observed") {
      const proof = canonicalJson([taking.input.kind, taking.outputVersion, taking.outcome.observation]);
      // Document/Work values establish this graph's authority and must still be interpreted.
      // All taking scopes and lifetimes are checked independently in the second loop below.
      if (taking.input.kind !== "document" && taking.input.kind !== "work" && verified?.has(proof))
        continue;
      const value = yield* reader.observation(taking);
      verified?.add(proof);
      if (
        taking.input.kind === "work" &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "handle" in value
      ) {
        const handle = workHandleSchema.safeParse(value.handle);
        if (!handle.success || workKey(handle.data.key) !== taking.input.key)
          return yield* refuse("scope", "Recorded Work handle differs from its taking");
        if (handle.data.key.binding === "address") {
          if (!sameAddress(wanted.data, handle.data.key.target))
            return yield* refuse("scope", "Recorded Work belongs to another document");
          workAuthority = true;
        }
      }
      if (taking.input.kind === "document" && taking.input.scope.startsWith('["document",')) {
        const row = yield* Schema.decodeUnknownEffect(documentRow)(value).pipe(
          Effect.mapError(() => refuse("scope", "Recorded document has no Address authority")),
        );
        const address = addressSchema.safeParse(row.address);
        if (!address.success || !sameAddress(wanted.data, address.data))
          return yield* refuse("scope", "Point consumption belongs to another document");
        if (
          taking.input.scope !==
            canonicalJson(["document", { session: row.session, openId: row.openId }]) ||
          taking.scope !== taking.input.scope
        )
          return yield* refuse("scope", "Recorded document row does not answer its selector");
        documents.set(canonicalJson({ session: row.session, openId: row.openId }), row);
      }
    }
  }
  if (!documents.size && !workAuthority)
    return yield* refuse("scope", "Point consumption has no recorded document authority");
  for (const id of ids) {
    const taking = reader.taking(id)!;
    if (
      taking.input.kind === "marks" &&
      (!documents.has(canonicalJson(taking.input.ref)) ||
        taking.scope !== canonicalJson(taking.input.ref))
    )
      return yield* refuse("scope", "Recorded marks have no authority for their document lifetime");
    if (taking.input.kind === "native") {
      const scope = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(hostSessionScopeSchema),
      )(taking.scope).pipe(
        Effect.mapError(() => refuse("scope", "Native taking has no valid document scope")),
      );
      if (
        !scope.bridgeSessionId ||
        ![...documents.values()].some(
          (row) =>
            row.session === scope.bridgeSessionId &&
            (scope.openDocumentId === undefined || row.openId === scope.openDocumentId),
        )
      )
        return yield* refuse("scope", "Native taking belongs to another session or document");
    }
    if (
      taking.outcome.kind === "answered" &&
      "openId" in taking.outcome.actualTarget.openDocumentLifetime
    ) {
      const openId = taking.outcome.actualTarget.openDocumentLifetime.openId;
      if (![...documents.values()].some((row) => row.openId === openId))
        return yield* refuse("scope", "Native taking belongs to another document lifetime");
    }
  }
  return { ids, metadata };
});

const acceptedRecipe = Schema.Struct({
  document: acceptedReadingSchema.fields.document,
  consumer: recordingConsumerSchema,
  bodyVersions: Schema.Array(Schema.String),
});
/** The subscription owner's kernel policy. All signed bodies are authenticated before writes.
 * Each mounted reading gets one metadata-only dependency root, including document authority
 * from this SAME accepted set when a body is session-scoped (for example native duct tables). */
export const acceptedPointPolicy = Effect.fn("RecordingPoints.acceptedPolicy")(function* (
  writer: RecordingWriter,
  receipts: ReturnType<typeof bodyReceipts>,
) {
  const live = Context.get(
    yield* Layer.build(HostInputReadSets.layer({ kind: "live", captureStore: writer })),
    HostInputReadSets,
  );
  const replay = Context.get(
    yield* Layer.build(
      HostInputReadSets.layer({ kind: "recording", recordingStore: writer, at: null }),
    ),
    HostInputReadSets,
  );
  const accept = Effect.fn("RecordingPoints.acceptedBatch")(function* (
    readings: readonly AcceptedReading[],
    audience: string | null,
    active: () => boolean,
  ) {
    // Fail closed before storing either connection slots or read-set metadata.
    const authenticated = yield* Effect.forEach(readings, (reading) =>
      Effect.gen(function* () {
        const claims = yield* Effect.forEach(reading.bodyReceipts, (receipt) =>
          receipts.verify(receipt, audience),
        );
        return { reading, claims };
      }),
    );
    for (const document of new Set(readings.map((reading) => reading.document))) {
      const claims = authenticated
        .filter(({ reading }) => reading.document === document)
        .flatMap(({ claims }) => claims);
      const id = randomUUID();
      const record: import("./native-recording.ts").InputReadSetRecord = {
        version: 1,
        id,
        identity: writer.identity,
        state: "complete",
        recipe: { key: "accepted.reading", input: null, scope: document },
        inputs: [],
        children: [],
        takingLinks: {},
        exports: [],
        dependencies: Object.fromEntries(claims.map((claim, at) => [String(at), claim.r])),
      };
      yield* references(
        {
          ...writer,
          readSets: {
            ...writer.readSets,
            get: (wanted) => (wanted === id ? Effect.succeed(record) : writer.readSets.get(wanted)),
          },
        },
        document,
        id,
      );
    }
    if (!active()) return yield* refuse("context", "Accepted connection retired");
    const at = writer.capture.begin();
    if (at === null) return;
    yield* Effect.gen(function* () {
      const kernel = yield* recordingPointKernel(writer, replay, {
        verify: (receipt) =>
          Effect.gen(function* () {
            const claim = yield* receipts.verify(receipt, audience);
            const root = yield* writer.readSets.get(claim.r);
            if (root.recipe.key !== "accepted.reading")
              return yield* refuse("receipt", "Receipt is not an accepted reading");
            const value = yield* Schema.decodeUnknownEffect(acceptedRecipe)(root.recipe.input).pipe(
              Effect.mapError(() => refuse("receipt", "Accepted reading metadata is invalid")),
            );
            return {
              document: value.document,
              consumer: value.consumer,
              readSetId: root.id as ReadSetId,
              identity: writer.identity,
              bodyVersion: claim.v,
            };
          }),
      });
      const documents = new Set(authenticated.map(({ reading }) => reading.document));
      for (const document of documents) {
        const group = authenticated.filter(({ reading }) => reading.document === document);
        // Authenticate the entire set first, then find a provable authority without using live inputs.
        let authority: string | undefined;
        for (const { claims } of group)
          for (const claim of claims) {
            const proof = yield* Effect.result(references(writer, document, claim.r));
            if (proof._tag === "Success" && !authority) authority = claim.r;
          }
        const caps: VerifiedAcceptedFrame[] = [];
        for (const { reading, claims } of group) {
          const root = yield* live.open(
            {
              key: "accepted.reading",
              scope: document,
              input: {
                document,
                consumer: { ...reading.consumer },
                bodyVersions: claims.map((claim) => claim.v),
              },
            },
            null,
          );
          try {
            for (const [index, claim] of claims.entries())
              yield* root.linkReadSet(`body:${index}`, claim.r as ReadSetId);
            if (authority && !claims.some((claim) => claim.r === authority))
              yield* root.linkReadSet("documentAuthority", authority as ReadSetId);
            yield* root.seal;
            yield* references(writer, document, root.id);
            // A normal unmount retires this acceptance, not the ancillary capture writer.
            if (!active()) return;
            const receipt = yield* receipts.mint(
              root.id,
              createHashForVersions(claims.map((claim) => claim.v)),
              audience,
            );
            if (!receipt) return;
            caps.push(yield* kernel.verifyAccepted(receipt));
          } finally {
            yield* root.close;
          }
        }
        if (active()) yield* kernel.checkpoint(document, { kind: "captured" }, caps);
      }
    }).pipe(
      Effect.catch((error) =>
        writer.capture.stop(
          at,
          error.problem === "recording.full"
            ? "full"
            : error.problem === "recording.io"
              ? "io"
              : "unsupported",
        ),
      ),
    );
  });
  return (...args: Parameters<typeof accept>) =>
    Effect.suspend(() => accept(...args).pipe(Effect.provideService(VerifiedObservations, new Set<string>())));
});
const references = recordingReadSetReferences;

const boundBodies = Effect.fn("RecordingPoints.boundBodies")(function* (
  reader: RecordingReader,
  document: Document,
  binding: RecordingPoint["bindings"][number],
) {
  const root = yield* reader.readSets.get(binding.readSetId);
  // Direct bindings predate authenticated mounted-body aggregation. Refuse rather than invent
  // their missing consumer/body correspondence or silently migrate them by scanning the store.
  if (root.recipe.key !== "accepted.reading" || root.recipe.scope !== document)
    return yield* refuse(
      "mismatch",
      "Point binding is not an accepted reading; capture a new point",
    );
  const input = yield* Schema.decodeUnknownEffect(acceptedRecipe)(root.recipe.input).pipe(
    Effect.mapError(() => refuse("mismatch", "Accepted reading metadata is invalid")),
  );
  const bodies = input.bodyVersions.map((_, index) => root.dependencies[`body:${index}`]);
  if (
    input.document !== document ||
    bindingKey(input.consumer) !== bindingKey(binding) ||
    !bodies.length ||
    bodies.some((id) => !id) ||
    input.bodyVersions.some((version) => !version) ||
    Object.keys(root.dependencies).filter((key) => key.startsWith("body:")).length !== bodies.length
  )
    return yield* refuse(
      "mismatch",
      "Accepted reading consumer, body versions or links differ from its binding",
    );
  return bodies;
});

/** Read-only port. No caller can turn a read-set name into a point. */
export function recordingPoints(reader: RecordingReader, readSets: ReadSets): RecordingPoints {
  const get = Effect.fn("RecordingPoints.get")(function* (
    document: Document,
    id: RecordingPointId,
  ) {
    const point = yield* reader.points.get(id);
    if (point.document !== document)
      return yield* refuse("scope", "Point belongs to another declared document");
    if (
      point.bindings.length > defaultReadSetLimits.childrenPerRoot ||
      Buffer.byteLength(JSON.stringify(point)) > defaultReadSetLimits.metadataBytesPerRoot
    )
      return yield* refuse("full", "Point metadata exceeds its bound");
    const { start, end } = point.takingRange;
    if (start > end || end > reader.takingCursor())
      return yield* refuse("mismatch", "Point cursor range is not in this recording");
    const cursor = new Map<string, number>();
    for (let at = start; at < end; at++) {
      const taking = reader.takingAt(at);
      if (!taking || cursor.has(taking.id))
        return yield* refuse("tamper", "Point cursor range has missing or duplicate takings");
      cursor.set(taking.id, at);
    }
    const seen = new Set<string>();
    let bytes = 0;
    for (const binding of point.bindings) {
      const key = bindingKey(binding);
      if (seen.has(key))
        return yield* refuse("ambiguous", "Point binds one mounted consumer twice");
      seen.add(key);
      yield* boundBodies(reader, document, binding);
      const refs = yield* references(reader, document, binding.readSetId);
      bytes += refs.metadata;
      if (bytes > defaultReadSetLimits.metadataBytesPerRoot)
        return yield* refuse("full", "Point consumption metadata exceeds its bound");
      for (const taking of refs.ids)
        if (!cursor.has(taking))
          return yield* refuse("mismatch", "Point consumption is outside its exact cursor range");
    }
    if (!seen.size) return yield* refuse("point", "Point has no accepted consumer bindings");
    return point;
  });
  return {
    get,
    list: Effect.fn("RecordingPoints.list")(function* (document) {
      const result: RecordingPoint[] = [];
      let bytes = 0;
      for (const id of reader.points.ids()) {
        const point = yield* reader.points.get(id);
        bytes += Buffer.byteLength(JSON.stringify(point));
        if (bytes > defaultReadSetLimits.metadataBytesPerRoot)
          return yield* refuse("full", "Point listing exceeds its metadata bound");
        if (point.document === document) result.push(yield* get(document, point.id));
      }
      return result;
    }),
    open: Effect.fn("RecordingPoints.open")(function* (document, id, consumer, recipe) {
      const point = yield* get(document, id);
      const binding = point.bindings.find((bound) => bindingKey(bound) === bindingKey(consumer));
      if (!binding)
        return yield* refuse("miss", "Point holds no binding for this mounted consumer");
      const bodies = yield* boundBodies(reader, document, binding);
      const graph = new Map(
        (yield* readSetRecords(reader, binding.readSetId)).map((record) => [record.id, record]),
      );
      const visited = new Set<string>(),
        matches: ReadSetId[] = [];
      const recipeKey = (recipe: ConsumerRecipe) =>
        canonicalJson([recipe.key, recipe.input, recipe.scope]);
      const visit = (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        const record = graph.get(id)!;
        if (recipeKey(record.recipe) === recipeKey(recipe)) matches.push(record.id as ReadSetId);
        record.children.forEach((child) => visit(child.readSetId));
        // Authority proves scope for the entire graph, but never supplies a displayed body.
        Object.entries(record.dependencies).forEach(([name, id]) => {
          if (name !== "documentAuthority") visit(id);
        });
      };
      bodies.forEach(visit);
      if (!matches.length)
        return yield* refuse("miss", "Accepted bodies hold no matching consumer recipe");
      if (matches.length > 1)
        return yield* refuse(
          "ambiguous",
          "Distinct accepted bodies match this recipe; an exact body binding is required",
        );
      // All graph/range refusals precede opening. The existing loader allocates only on success.
      return yield* readSets.open(recipe, matches[0]!);
    }),
  };
}

/** Kernel composition only; not a route service. Parent supplies the verifier backed by its
 * final-body acceptance receipts. Capture failure stops ancillary recording and never fails live. */
export const recordingPointKernel = Effect.fn("RecordingPoints.kernel")(function* (
  writer: RecordingWriter,
  readSets: ReadSets,
  verifier: AcceptedFrameVerifier,
) {
  const clock = yield* Clock.Clock;
  const claims = new WeakMap<VerifiedAcceptedFrame, AcceptedFrameEvidence>();
  const points = recordingPoints(writer, readSets);
  const verifyAccepted = Effect.fn("RecordingPoints.verifyAccepted")(function* (receipt: string) {
    const evidence = yield* verifier.verify(receipt);
    if (
      !evidence.bodyVersion ||
      evidence.identity.build !== writer.identity.build ||
      evidence.identity.catalog !== writer.identity.catalog
    )
      return yield* refuse(
        "mismatch",
        "Accepted body receipt belongs to another build or has no version",
      );
    yield* references(writer, evidence.document, evidence.readSetId);
    const cap = Object.freeze({}) as VerifiedAcceptedFrame;
    claims.set(cap, structuredClone(evidence));
    return cap;
  });
  // Private mint: the only source of bindings is this kernel's verified capability map.
  const mint = Effect.fn("RecordingPoints.mint")(function* (
    document: Document,
    reason: RecordingPointReason,
    accepted: readonly VerifiedAcceptedFrame[],
  ) {
    if (writer.capture.truncated())
      return yield* refuse("context", "Capture has stopped; no new point can be kept");
    if (!accepted.length || accepted.length > defaultReadSetLimits.childrenPerRoot)
      return yield* refuse("full", "Point needs a bounded nonempty accepted consumer set");
    const bindings: RecordingPoint["bindings"][number][] = [];
    const ids = new Set<string>();
    for (const cap of accepted) {
      const claim = claims.get(cap);
      if (!claim || claim.document !== document)
        return yield* refuse("scope", "Accepted frame capability is missing or foreign");
      bindings.push({ ...claim.consumer, readSetId: claim.readSetId });
      const refs = yield* references(writer, document, claim.readSetId);
      refs.ids.forEach((id) => ids.add(id));
    }
    let start = writer.takingCursor(),
      end = 0;
    for (let cursor = 0; cursor < writer.takingCursor(); cursor++) {
      if (ids.delete(writer.takingAt(cursor)!.id)) {
        start = Math.min(start, cursor);
        end = cursor + 1;
      }
    }
    if (ids.size || start >= end)
      return yield* refuse("miss", "Accepted consumption has no durable taking range");
    const point = yield* Schema.decodeUnknownEffect(recordingPointSchema)({
      version: 1,
      id: randomUUID(),
      document,
      reason,
      at: clock.currentTimeMillisUnsafe(),
      identity: writer.identity,
      takingRange: { start, end },
      bindings,
    }).pipe(Effect.mapError(() => refuse("input", "Point metadata is invalid")));
    // Validate before writing: no incomplete or forged graph can become a durable point.
    const staged: RecordingReader = {
      ...writer,
      points: { ...writer.points, get: () => Effect.succeed(point) },
    };
    yield* recordingPoints(staged, readSets).get(document, point.id);
    yield* writer.points.keep(point);
    return point;
  });
  return {
    points,
    verifyAccepted,
    checkpoint: Effect.fn("RecordingPoints.checkpoint")(function* (
      document: Document,
      reason: RecordingPointReason,
      accepted: readonly VerifiedAcceptedFrame[],
    ) {
      const at = writer.capture.begin();
      if (at === null) return null;
      return yield* mint(document, reason, accepted).pipe(
        Effect.catch((error) =>
          Effect.as(
            writer.capture.stop(
              at,
              error.problem === "recording.full"
                ? "full"
                : error.problem === "recording.io"
                  ? "io"
                  : "unsupported",
            ),
            null,
          ),
        ),
      );
    }),
  };
});
