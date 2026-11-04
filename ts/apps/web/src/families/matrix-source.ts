import { z } from "zod";
import {
  canonicalRouteInput,
  workKey,
  workKeySchema,
  familiesMatrixEnvelopeSchema,
  familiesObservationSchema,
  type ReadingRequest,
} from "@pe/agent-contracts";
import type { RevitMatrixLoadedFamilies } from "@pe/host-contracts/generated";
import {
  familiesReads,
  readFamiliesCapture,
  type FamiliesObservation,
} from "../../../../packages/mcps/src/shared/families-client";
import { callCompose } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingAttempt, UseSource } from "#/shell/readings";
import type { Readings } from "#/readings";
const scopeFilter = (scope: { args?: unknown }) =>
  familiesReads["families.read"].input.extend({ work: workKeySchema }).parse(scope.args).filter;
type FamilyRecord = RevitMatrixLoadedFamilies.Res.FamilySnapshotRecord;

/** A promise keeps the attempt that fetched it. A returned A cannot adopt the first A's parts. */
export function familiesMatrixSource(resources?: Readings): UseSource<FamiliesObservation | null> {
  const runs = new Map<
    string,
    {
      attempt: ReadingAttempt;
      signal: AbortSignal;
      complete: boolean;
      records: Map<string, { attempt: ReadingAttempt; body: Promise<FamilyRecord> }>;
    }
  >();
  return {
    kind: "use",
    dirties: ["families", "matrix"],
    async open(ctx, deliver) {
      const target = ctx.target.kind === "document" ? ctx.target.ref : null;
      const filter = scopeFilter(ctx);
      const args = familiesReads["families.read"].input
        .extend({ work: workKeySchema })
        .safeParse(ctx.args);
      const bound = args.success
        ? z.object({ work: workKeySchema }).parse(ctx.args).work
        : ctx.workKey;
      if (!target || !filter?.categoryNames.length)
        return deliver({ kind: "complete", value: null, revision: 0 });
      let latest = "";
      let serial = 0;
      const seen = new Set<string>();
      const accept = async (id: string) => {
        const parts = await callCompose(ctx, "families.readings", {
          query: { id, format: "parts" },
        });
        if (!parts || !("reading" in parts)) throw Error("Expected Families reading parts");
        const { reading, records } = parts;
        if (ctx.signal.aborted || latest !== id) return;
        if (
          canonicalRouteInput(reading.document) !== canonicalRouteInput(target) ||
          canonicalRouteInput(reading.filter) !== canonicalRouteInput(filter) ||
          workKey(reading.work) !== (bound ? workKey(bound) : null)
        )
          return;
        const runId = reading.progress?.runId ?? reading.id;
        let origin = runs.get(runId);
        if (origin && origin.attempt !== ctx.attempt && !origin.complete) return;
        if (origin?.complete && reading.progress && reading.progress.state !== "complete") return;
        if (!origin || origin.attempt !== ctx.attempt) {
          origin = {
            attempt: ctx.attempt,
            signal: ctx.signal,
            complete: false,
            records: new Map(),
          };
          runs.set(runId, origin);
          const records = origin.records;
          ctx.signal.addEventListener("abort", () => records.clear(), { once: true });
        }
        const owned = origin;
        const families = records
          ? await Promise.all(
              records.map((hash) => {
                let entry = owned.records.get(hash);
                if (!entry) {
                  const body = callCompose({ signal: owned.signal }, "families.readings", {
                    query: { record: hash },
                  })
                    .then((value) => {
                      if (!value || !("familyId" in value))
                        throw Error("Expected a Families record");
                      return value;
                    })
                    .catch((error: unknown) => {
                      owned.records.delete(hash);
                      throw error;
                    });
                  entry = { attempt: owned.attempt, body };
                  owned.records.set(hash, entry);
                }
                if (entry.attempt !== ctx.attempt) throw Error("Retired Families part attempt");
                return entry.body;
              }),
            )
          : reading.result.families;
        if (ctx.signal.aborted || latest !== id || owned.attempt !== ctx.attempt) return;
        const complete = !reading.progress || reading.progress.state === "complete";
        owned.complete = complete;
        deliver({
          kind: complete ? "complete" : "part",
          value: { ...reading, result: { ...reading.result, families } },
          revision: ++serial,
          sourceVersion: id,
        });
      };
      const close = await subscriptionSource({
        request: (): ReadingRequest => ({ kind: "families-matrix", target, filter }),
        decode: (value) => familiesMatrixEnvelopeSchema.parse(value),
        resources,
      }).open(ctx, (publication) => {
        if (publication.kind !== "complete") {
          if (
            publication.kind === "failure" ||
            publication.kind === "stale" ||
            publication.kind === "pending"
          )
            deliver(publication);
          return;
        }
        const id = publication.value?.bodyVersion;
        if (!id) return deliver({ kind: "complete", value: null, revision: ++serial });
        if (seen.has(id)) return;
        latest = id;
        seen.add(id);
        // A new body revision invalidates the prior basis while immutable parts are assembled.
        deliver({ kind: "stale" });
        void accept(id).catch((error: unknown) => {
          if (!ctx.signal.aborted && latest === id) deliver({ kind: "failure", error });
        });
      });
      if (args.success) {
        // The POST owns completion's host baseline. Subscription parts remain inspectable.
        void readFamiliesCapture(
          "families.read",
          {
            filter: args.data.filter,
            readId: args.data.readId,
            expectedRevision: args.data.expectedRevision,
          },
          args.data.work,
          target,
        )
          .then((reading) => {
            if (ctx.signal.aborted) return;
            deliver({
              kind: "complete",
              value: familiesObservationSchema.parse(reading),
              revision: ++serial,
            });
          })
          .catch((error: unknown) => {
            if (!ctx.signal.aborted) deliver({ kind: "failure", error });
          });
      }
      return close;
    },
  };
}
