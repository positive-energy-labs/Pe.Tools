import { z } from "zod";
import {
  actionReceiptSchema,
  canonicalRouteInput,
  workKey,
  type AppliedFilter,
  familiesMatrixEnvelopeSchema,
  type FamiliesRouteDocument,
  type ReadingRequest,
} from "@pe/agent-contracts";
import type { RevitMatrixLoadedFamilies } from "@pe/host-contracts/generated";
import type { PodList } from "@pe/host-contracts/operation-types";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import {
  familiesObservationSchema,
  type FamiliesObservation,
  type FamiliesObservationSummary,
} from "../../../../packages/mcps/src/shared/families-client";
import { jsonSource, requestJson } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingAttempt, ReadingContext, ReadingSource, UseSource } from "#/shell/readings";
import type { Readings } from "#/readings";
import type { FamiliesPage } from "./graph";

export type { FamiliesObservation, FamiliesObservationSummary };
export type FamiliesDraft = {
  placement: AppliedFilter["placementScope"];
  categories: string[];
  families: string[] | null;
};
export const draftFilter = (draft: FamiliesDraft): AppliedFilter => ({
  categoryNames: [...draft.categories],
  familyNames: [...(draft.families ?? [])],
  placementScope: draft.placement,
});
export const scopeDraft = (
  draft: FamiliesDraft | null,
  work: FamiliesRouteDocument | null,
): FamiliesDraft => {
  if (draft) return draft;
  const filter = work?.scope.edit?.value;
  return {
    categories: [...(filter?.categoryNames ?? [])],
    families: filter?.familyNames.length ? [...filter.familyNames] : null,
    placement: filter?.placementScope ?? "PlacedOnly",
  };
};
const scopeFilter = (scope: { page: unknown; work: unknown }) => {
  const drafted = (scope.page as FamiliesPage).draft;
  return draftFilter(scopeDraft(drafted, scope.work as FamiliesRouteDocument | null));
};

const partsSchema = z.object({
  reading: familiesObservationSchema,
  records: z.array(z.string()).nullable(),
});
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
    key: scopeFilter,
    dirties: ["families", "matrix"],
    async open(ctx, deliver) {
      const target = ctx.target.kind === "document" ? ctx.target.ref : null;
      const filter = scopeFilter(ctx);
      if (
        !target ||
        !filter?.categoryNames.length ||
        (ctx.page as FamiliesPage).stage === "history"
      )
        return deliver({ kind: "complete", value: null, revision: 0 });
      let latest = "";
      let serial = 0;
      const seen = new Set<string>();
      const accept = async (id: string) => {
        const { reading, records } = await requestJson(
          { path: `/families/readings?id=${encodeURIComponent(id)}&format=parts` },
          partsSchema,
          ctx.signal,
        );
        if (ctx.signal.aborted || latest !== id) return;
        if (
          canonicalRouteInput(reading.document) !== canonicalRouteInput(target) ||
          canonicalRouteInput(reading.filter) !== canonicalRouteInput(filter) ||
          workKey(reading.work) !== (ctx.workKey ? workKey(ctx.workKey) : null)
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
                  const body = requestJson(
                    { path: `/families/readings?record=${encodeURIComponent(hash)}` },
                    z.custom<FamilyRecord>(),
                    owned.signal,
                  ).catch((error: unknown) => {
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
      return subscriptionSource({
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
    },
  };
}

const page = (ctx: ReadingContext) => ctx.page as FamiliesPage;
export function familiesSources(): Readonly<Record<string, ReadingSource>> {
  return {
    "families.matrix": familiesMatrixSource(),
    "families.receipts": subscriptionSource({
      request: () => ({ kind: "receipts" }),
      decode: (value) => z.array(actionReceiptSchema).parse(value),
      dirties: ["families", "receipts"],
    }),
    "families.categories": {
      kind: "use",
      dirties: ["families"],
      open(ctx, deliver) {
        const target = ctx.target.kind === "document" ? ctx.target.ref : null;
        if (!target) return deliver({ kind: "complete", value: [], revision: 0 });
        return subscriptionSource({
          request: () => ({ kind: "field-options", target, key: "category-names" }),
          decode: (value) =>
            z
              .object({ items: z.array(z.object({ value: z.string() })) })
              .parse(value)
              .items.map((item) => item.value),
        }).open(ctx, deliver);
      },
    },
    "families.catalog": jsonSource({
      request: (ctx) =>
        ctx.target.kind === "document"
          ? {
              path: "/call",
              body: {
                key: "revit.catalog.loaded-families",
                request: { filter: {}, budget: { maxEntries: 5000 } },
              },
              headers: {
                [HOST_RPC_BRIDGE_SESSION_HEADER]: ctx.target.ref.session,
                [HOST_RPC_DOCUMENT_HEADER]: ctx.target.ref.openId,
              },
            }
          : null,
      schema: z
        .object({
          families: z.array(
            z.object({
              familyId: z.number(),
              familyName: z.string(),
              categoryName: z.string().nullish(),
              placedInstanceCount: z.number(),
            }),
          ),
        })
        .transform((value) => value.families),
      absent: [],
    }),
    "families.archive": jsonSource({
      request: (ctx) => (page(ctx).stage === "history" ? { path: "/families/readings" } : null),
      schema: z.array(z.custom<FamiliesObservationSummary>()),
      absent: [],
    }),
    "families.saved": jsonSource({
      request: (ctx) => {
        const id =
          page(ctx).past ||
          (ctx.inputs.archive?.value as FamiliesObservationSummary[] | undefined)?.[0]?.id;
        return page(ctx).stage === "history" && id
          ? { path: `/families/readings?id=${encodeURIComponent(id)}` }
          : null;
      },
      schema: familiesObservationSchema.nullable(),
      absent: null,
    }),
    "families.pods": {
      ...jsonSource({
        request: () => ({ path: "/call", body: { key: "pod.list", request: {} } }),
        schema: z
          .object({ pods: z.array(z.custom<PodList["pods"][number]>()) })
          .transform((value) => value.pods),
        absent: [],
      }),
      effects: () => [],
      dirties: ["pods"],
    },
  };
}
