/** One body per declared reading. Each maps a native read to the shape the declaration gives it. */
import { z } from "zod";
import {
  readingRequestSchema,
  stagedAdoptChoices,
  takeoffCaptureSchema,
  takeoffCaptureSummarySchema,
  takeoffSnapshotInput,
  type DocumentRef,
} from "@pe/agent-contracts";
import { native } from "@pe/agent-contracts/handle";
import type { HostBodies } from "@pe/agent-contracts/product";
import { readZoneMeta } from "@pe/agent-contracts/takeoff-adoption";
import { BridgeError } from "@pe/host-internal/bridge";
import { leaf, type ReadContext } from "@pe/host-internal/read-graph";
import { workBinding, workRead } from "@pe/host-internal/reads/work";
import { product, regionCode, takeoffsWork } from "@pe/rooms-contract/product";

const doc = (ref: DocumentRef) => ({ kind: "document" as const, ref });
const planGone = (error: unknown): error is BridgeError =>
  error instanceof BridgeError &&
  (error.evidence.issues?.some((issue) => issue.code === "RoomsViewMissing") ?? false);
const point2 = z.tuple([z.number(), z.number()]);
/** A native point is a list; fewer than two numbers is refused, never read as zero. */
const xy = (point: readonly number[]) => point2.parse(point.slice(0, 2));
const ring = (points: readonly (readonly number[])[]) => points.map(xy);
const unreadable = (rows: readonly { parameter: string; reason: string }[] | null | undefined) =>
  (rows ?? []).map(({ parameter, reason }) => ({ parameter, reason }));
const savedCapture = leaf("resource", readingRequestSchema, takeoffCaptureSchema.nullable());
const retained = leaf("file:takeoff-capture", takeoffSnapshotInput, takeoffCaptureSchema, false);
const savedCaptures = leaf("resource", readingRequestSchema, z.array(takeoffCaptureSummarySchema));

export const readings: HostBodies<typeof product, ReadContext, never>["readings"] = {
  async plans(ctx, { target }) {
    const { body } = await ctx.read(native("rooms.roster"), { target: doc(target), request: {} });
    return {
      trackedRegionIds: body.trackedRegionIds ?? null,
      levels: body.levels.map((level) => ({
        name: level.name,
        elevationFt: level.elevation,
        views: level.views.map((row) => ({ view: row.uniqueId, name: row.name, type: row.type })),
      })),
    };
  },
  async regions(ctx, { target, view }) {
    if (!view) return { missing: null, regions: [], unreadable: [] };
    const read = await ctx
      .read(native("rooms.snapshot"), { target: doc(target), request: { view } })
      .catch((error: unknown) => {
        // Only the native "this plan left the document" answer, by its typed issue code.
        if (planGone(error)) return error.message;
        throw error;
      });
    if (typeof read === "string") return { missing: read, regions: [], unreadable: [] };
    const { body } = read;
    return {
      missing: null,
      regions: body.regions.map((row) => ({
        subject: regionCode(row.uniqueId),
        role: z.enum(["zone", "room", "held"]).parse(row.role),
        zone: row.zone ? regionCode(row.zone) : null,
        name: row.name,
        type: row.type,
        ceilingFt: row.ceilingFt ?? null,
        people: row.people ?? null,
        lightingW: row.lightingW ?? null,
        equipSensible: row.equipSensible ?? null,
        equipLatent: row.equipLatent ?? null,
        ventilationCfm: row.ventilationCfm ?? null,
        sqft: row.sqft,
        outer: ring(row.outer),
        holes: row.holes.map(ring),
        label: xy(row.label),
        runId: row.runId,
        reason: row.reason ?? null,
        touched: row.touched,
        locked: row.locked,
        stale: row.stale,
      })),
      unreadable: unreadable(body.unreadable),
    };
  },
  async evidence(ctx, { target, view, runId }) {
    if (!view) return { runId: "", zones: [] };
    const { body } = await ctx.read(native("rooms.trace"), {
      target: doc(target),
      request: { view, runId },
    });
    return {
      runId: body.runId,
      zones: body.zones.map(({ zoneUniqueId, label, trace, accounting }) => ({
        zone: regionCode(zoneUniqueId),
        label,
        rails: trace.rails.map((rail) => ({
          a: xy(rail.a),
          b: xy(rail.b),
          thicknessFt: rail.thicknessFt,
          source: rail.source,
          category: rail.category,
        })),
        segments: trace.segments.map((row) => ({ a: xy(row.a), b: xy(row.b), kind: row.kind })),
        openings: trace.openings.map((row) => ({
          a: xy(row.a),
          b: xy(row.b),
          widthFt: row.widthFt,
          kind: row.kind,
        })),
        sqft: {
          zone: accounting.zoneSqft,
          accepted: accounting.accepted,
          held: accounting.held,
          void: accounting.void,
          excluded: accounting.excluded,
        },
      })),
    };
  },
  async planImage(ctx, { target, view }) {
    if (!view) return { raster: null, refusal: null };
    const { body } = await ctx.read(native("revit.context.view-image"), {
      target: doc(target),
      request: { target: { uniqueId: view } },
    });
    const { imageUrl, registration } = body;
    return {
      raster:
        imageUrl && registration
          ? {
              href: imageUrl,
              registration: {
                width: registration.width,
                height: registration.height,
                topLeft: xy(registration.topLeft),
                topRight: xy(registration.topRight),
                bottomLeft: xy(registration.bottomLeft),
              },
            }
          : null,
      refusal: body.registrationRefusal ?? (body.refused ? "No image was exported" : null),
    };
  },
  async adoption(ctx, { target, views }) {
    const key = await ctx.read(workBinding, { route: "takeoffs", target: doc(target) });
    const work = key && (await ctx.read(workRead("takeoffs", takeoffsWork.schema), key));
    const choices = stagedAdoptChoices(takeoffsWork.schema.parse(work?.doc ?? {}));
    const roster = views.length
      ? await ctx.read(native("rooms.roster"), { target: doc(target), request: {} })
      : null;
    const listed = new Map(
      roster?.body.levels.flatMap((level) =>
        level.views.map((row) => [row.uniqueId, { name: row.name, level: level.name }] as const),
      ),
    );
    // Resolve candidates first: a plan can disappear between the roster and its request.
    const requested = [...new Set(views)];
    const read = await Promise.all(
      requested.map(async (view) => {
        const plan = listed.get(view);
        if (!plan) return { view, body: null };
        try {
          const { body } = await ctx.read(native("takeoffs.candidates"), {
            target: doc(target),
            request: { view },
          });
          return { view, body, plan };
        } catch (error) {
          if (planGone(error)) return { view, body: null };
          throw error;
        }
      }),
    );
    let candidates = read.filter((row) => row.body !== null);
    const snapshotFor = async (views: string[]) =>
      (
        await ctx.read(native("takeoffs.snapshot"), {
          target: doc(target),
          request: { views, zoneUniqueIds: [] },
        })
      ).body;
    let response: Awaited<ReturnType<typeof snapshotFor>>;
    for (;;) {
      try {
        response = await snapshotFor(candidates.map(({ view }) => view));
        break;
      } catch (error) {
        if (!planGone(error) || !candidates.length) throw error;
        // Revit may delete a plan between the candidate and snapshot reads. Isolate the typed
        // refusal by plan, then retry the combined snapshot only with a strictly smaller scope.
        const surviving =
          candidates.length === 1
            ? []
            : await Promise.all(
                candidates.map(async (candidate) => {
                  try {
                    await snapshotFor([candidate.view]);
                    return candidate;
                  } catch (error) {
                    if (planGone(error)) return null;
                    throw error;
                  }
                }),
              );
        const remaining = surviving.filter((row) => row !== null);
        if (remaining.length === candidates.length) throw error;
        candidates = remaining;
      }
    }
    const { snapshot } = response;
    const liveViews = new Set(candidates.map(({ view }) => view));
    if (liveViews.size)
      await ctx.read(retained, {
        target,
        snapshot: response,
        views: candidates.map(({ plan }) => plan),
      });
    const { carriers } = snapshot.status;
    return {
      missingViews: requested.filter((view) => !liveViews.has(view)),
      rows: candidates.flatMap(({ body, view }) =>
        body.regions.map((row) => {
          const adopted = row.role === "zoning-region";
          const meta = adopted && !row.unreadable ? readZoneMeta(row.blob) : null;
          // Keyed by the UniqueId of the view, never its name: two plans of a level may share one.
          const key = `${view}:${row.elementId}`;
          return {
            key,
            view,
            viewName: row.view,
            elementId: row.elementId,
            uniqueId: row.uniqueId,
            typeName: row.typeName,
            sqft: row.sqft,
            adopted,
            checked: adopted,
            name: meta?.name || row.typeName || `${row.view} · ${row.elementId}`,
            systemTag: meta?.systemTag ?? "",
            unreadable: row.unreadable ?? null,
            ...choices[key],
          };
        }),
      ),
      carriers: {
        stage: carriers.stage,
        status: carriers.status,
        missing: carriers.missingCarrierGuids,
      },
      unreadable: unreadable(snapshot.unreadable),
    };
  },
  async captures(ctx, { capture }) {
    return {
      captures: await ctx.read(savedCaptures, { kind: "takeoff-saved" }),
      saved: capture ? await ctx.read(savedCapture, { kind: "takeoff-saved", id: capture }) : null,
    };
  },
};
