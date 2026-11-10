/** ADR0031 epochs: metadata over the existing recording and consumption graph, never a journal. */
import { Effect, Schema } from "effect";
import {
  addressSchema,
  sameAddress,
  workHandleSchema,
  workKey,
  type RecordingPoint,
  type RecordingPointId,
  type RecordingConsumer,
} from "@pe/agent-contracts";
import {
  documentKeySchema,
  type DocumentKey,
} from "../../../packages/agent-contracts/src/subject-ref.ts";
import { canonicalJson } from "@pe/host-internal/native-read";
import { hostSessionScopeSchema } from "@pe/host-contracts/operation-types";
import {
  defaultReadSetLimits,
  readSetRecords,
  HostInputReadSets,
  type InputConsumption,
  type ReadSetId,
} from "./input-occurrence.ts";
import type { ConsumerRecipe, RecordingReader } from "./native-recording.ts";
import { InvalidRead } from "./native-reads.ts";

type Document = DocumentKey;
type ReadSets = HostInputReadSets["Service"];
const refuse = (problem: string, message: string) =>
  new InvalidRead({ message, status: 409, problem: `recording.${problem}` });
const bindingKey = (binding: RecordingConsumer) =>
  canonicalJson([binding.instance, binding.reading, binding.argsHash]);
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
  if (!documentKeySchema.safeParse(document).success)
    return yield* refuse("scope", "Invalid declared document identity");
  const wanted = addressSchema.safeParse(document);
  if (!wanted.success) return yield* refuse("scope", "Document has no recorded Address authority");
  const records = yield* readSetRecords(reader, id);
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
      const value = yield* reader.observation(taking);
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
        return yield* refuse("ambiguous", "Point binds one subscription twice");
      seen.add(key);
      const refs = yield* recordingReadSetReferences(reader, document, binding.readSetId);
      bytes += refs.metadata;
      if (bytes > defaultReadSetLimits.metadataBytesPerRoot)
        return yield* refuse("full", "Point consumption metadata exceeds its bound");
      for (const taking of refs.ids)
        if (!cursor.has(taking))
          return yield* refuse("mismatch", "Point consumption is outside its exact cursor range");
    }
    if (!seen.size) return yield* refuse("point", "Point has no published consumer bindings");
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
        return yield* refuse("miss", "Point holds no binding for this subscription");
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
      visit(binding.readSetId);
      if (!matches.length)
        return yield* refuse("miss", "Bound graph holds no matching consumer recipe");
      if (matches.length > 1)
        return yield* refuse(
          "ambiguous",
          "Distinct read sets match this recipe; an exact body binding is required",
        );
      // All graph/range refusals precede opening. The existing loader allocates only on success.
      return yield* readSets.open(recipe, matches[0]!);
    }),
  };
}
