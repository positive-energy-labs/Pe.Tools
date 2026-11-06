import { nativeRequestSchema } from "@pe/host-contracts/decoders";
import { BridgeError as InputBridgeError } from "@pe/host-internal/dispatch";
import { BridgeError } from "../bridge.ts";
import { sheetState } from "@pe/ducts-domain/sheet/state";
import { z } from "zod";
import { workKeySchema, type WorkKey } from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import type { HostMarks } from "../document-marks.ts";
import type { DuctsSheetSources } from "../ducts-sheet.ts";
import { createDuctsSheets } from "../ducts-sheet.ts";
import {
  ductsSnapshotReadingSchema,
  FAN_READ_MAX,
  fansReadArgs,
  fansSheetData,
  openFanSheetSchema,
} from "@pe/agent-contracts";
import {
  ductsDesign,
  stagedDucts,
  ductsDocumentSchema,
  fansDocumentSchema,
  DUCTS_BODY_VERSION_HEADER,
} from "@pe/agent-contracts";
import { leaf, read, RefusedPartition, type InputPort, type ReadContext } from "./evaluator.ts";
import { sheetSnapshot } from "@pe/ducts-domain/sheet/scoped-snapshot";

export const documentMark = {
  ...leaf("document-mark", fansReadArgs.shape.target, z.unknown()),
  fence: true,
};
const firm = leaf("firm", z.null(), z.unknown());
const catalogs = leaf("catalogs", z.null(), z.unknown());
const nativeInput = leaf(
  "native",
  z
    .discriminatedUnion("key", [
      z.object({
        key: z.literal("ducts.snapshot.roster"),
        request: nativeRequestSchema("ducts.snapshot.roster").and(
          ductsSnapshotReadingSchema.omit({ kind: true, target: true }),
        ),
      }),
      z.object({
        key: z.literal("ducts.snapshot.walk"),
        request: nativeRequestSchema("ducts.snapshot.walk").and(
          ductsSnapshotReadingSchema.omit({ kind: true, target: true }),
        ),
      }),
      z.object({ key: z.literal("ducts.tables"), request: nativeRequestSchema("ducts.tables") }),
    ])
    .and(
      z.object({
        target: fansReadArgs.shape.target,
        version: z.string().optional(),
        role: z.enum(["acquire", "validate", "join", "beyond"]).optional(),
      }),
    ),
  z.object({ body: z.unknown(), version: z.string().nullable() }),
  false,
);
const native = read("fans.native", {
  input: nativeInput.input,
  output: nativeInput.output,
  async run(ctx, args) {
    await ctx.read(documentMark, args.target);
    return ctx.read(nativeInput, args);
  },
});
const workValue = z.object({ doc: z.unknown(), revision: z.number() }).passthrough().nullable();

const openFan = read("fans.open", {
  input: fansReadArgs
    .pick({ target: true, sheetPath: true })
    .extend({ unitId: z.number(), portIndex: z.number() }),
  output: openFanSheetSchema,
  async run(ctx, args) {
    const sheets = createDuctsSheets(sheetSources(ctx));
    const request = {
      target: args.target,
      mode: "fan" as const,
      unitId: args.unitId,
      portIndex: args.portIndex,
    };
    const overview = await sheets.sheet(request);
    if (overview.kind !== "overview") throw Error("Expected a fan overview");
    const detail = async <K extends "inputs" | "elements" | "worksheet" | "legs">(
      kind: K,
      pathId = "",
    ) => {
      const value = await sheets.sheet({
        ...request,
        basis: overview.basis,
        detail: kind === "legs" ? { kind, pathId } : { kind },
      });
      if (value.kind !== kind || value.basis !== overview.basis)
        throw Error("Sheet detail does not match its overview");
      return value as Extract<typeof value, { kind: K }>;
    };
    const worst = (["supply", "return"] as const).flatMap((side) =>
      overview.totals?.[side].complete && overview.paths[side].paths[0]
        ? [overview.paths[side].paths[0]!.pathId]
        : [],
    );
    const paths = [...new Set([...worst, ...(args.sheetPath ? [args.sheetPath] : [])])];
    const inputs = await detail("inputs"),
      elements = await detail("elements"),
      worksheet = await detail("worksheet");
    const legs = await Promise.all(paths.map((path) => detail("legs", path)));
    return {
      overview,
      inputs,
      elements,
      worksheet,
      legs: legs[args.sheetPath ? paths.indexOf(args.sheetPath) : 0] ?? null,
      worstLegs: legs.slice(0, worst.length),
    };
  },
});

/** The Fans read owns the join; its adapter has no untracked Work/file/native access. */
export const fansSheet = read("fans.sheet", {
  input: fansReadArgs,
  output: fansSheetData,
  async run(ctx, args) {
    await ctx.read(documentMark, args.target);
    // A fresh composer has no retained calculation that could hide dependencies from this trace.
    // Native body retention remains in its existing recordable input service.
    const source = sheetSources(ctx);
    const sheets = createDuctsSheets(source);
    const fans = await sheets.roster({ target: args.target });
    const chosen =
      args.fan === "all"
        ? fans.rows
        : [...new Set(args.fan)].map((key) => {
            const row = fans.rows.find((row) => `${row.uniqueId}@${row.portIndex}` === key);
            if (!row) throw Error(`Fan '${key}' is unavailable; choose it from the roster`);
            return row;
          });
    if (chosen.length > FAN_READ_MAX) throw Error("Open at most 32 fan ports in one sheet");
    const opened = await ctx.collect(chosen, {
      read: openFan,
      batch: 1,
      key: (fan) => `${fan.uniqueId}@${fan.portIndex}`,
      args: ([fan]) => ({
        target: args.target,
        sheetPath: args.sheetPath,
        unitId: fan!.unitId,
        portIndex: fan!.portIndex,
      }),
      covered: (open) =>
        chosen.filter(
          (fan) =>
            fan.unitId === open.overview.fan?.unitId &&
            fan.portIndex === open.overview.fan?.portIndex,
        ),
    });
    const rows = fans.rows.map((row) => {
      const overview = opened.find(
        (open) =>
          open.overview.fan?.unitId === row.unitId &&
          open.overview.fan?.portIndex === row.portIndex,
      )?.overview;
      return overview
        ? {
            ...row,
            blockerCount: overview.blockers.length,
            requiredEspInWg: overview.totals?.requiredEspInWg ?? null,
            requiredEspAssumedInWg: overview.totals?.requiredEspAssumedInWg ?? null,
            complete: !!overview.totals?.supply.complete && !!overview.totals?.return.complete,
          }
        : row;
    });
    const scope = await source.workKey!(args.target);
    const ducts = workValue.parse(await ctx.work("ducts", scope));
    const fansWork = workValue.parse(await ctx.work("fans", { ...scope, route: "fans" }));
    const ductsDoc = ductsDocumentSchema.parse(ducts?.doc ?? {}),
      fansDoc = fansDocumentSchema.parse(fansWork?.doc ?? {});
    const design = ductsDesign(ductsDoc, fansDoc),
      staged = stagedDucts(design, design);
    const ids = [
      ...new Set(
        opened.flatMap((open) => [
          open.overview.fan!.unitId,
          ...(open.elements?.walkedElementIds ?? []),
          ...(open.elements?.beyond ?? []).flatMap((unit) => unit.elementIds),
          ...(open.inputs?.blockers ?? []).flatMap((blocker) =>
            [
              blocker.elementId,
              blocker.closer.candidate?.toElementId,
              blocker.proposal?.to.elementId,
            ].filter((id): id is number => id != null),
          ),
        ]),
      ),
    ].sort((a, b) => a - b);
    const geometry = ids.length
      ? await ctx.read(native, {
          key: "ducts.snapshot.walk",
          request: {
            slots: staged.parameters,
            labelParameter: staged.labelParameter ?? undefined,
            selector: { kind: "ids", ids },
          },
          target: args.target,
        })
      : null;
    return ctx.compute(
      fansSheetData,
      { opened, rows, fans, ducts, fansWork, geometry },
      (data) => ({
        open: data.opened[0] ?? null,
        opened: [...data.opened],
        rows: data.rows,
        progress: null,
        sheetView: fansSheetData.shape.sheetView.parse(sheetState(data.opened[0] ?? null)),
        fans: { ...data.fans, rows: data.rows },
        ductsWork: ductsDoc,
        fansWork: fansDoc,
        sheetSnapshot: data.geometry
          ? {
              ...sheetSnapshot(data.geometry.body as Parameters<typeof sheetSnapshot>[0]),
              sourceVersion: data.geometry.version ?? undefined,
            }
          : { kind: "absent" },
      }),
    );
  },
});

// Leaf handles are private to this adapter. Domain reads never get the workspace or file service.
const workScope = leaf("work-scope", fansReadArgs.shape.target, workKeySchema, false);
function sheetSources(ctx: ReadContext): DuctsSheetSources {
  return {
    workKey: (target) => ctx.read(workScope, target),
    readWork: async (owner, scope) => workValue.parse(await ctx.work(owner, scope)),
    firm: async () =>
      (await ctx.read(firm, null)) as Awaited<ReturnType<DuctsSheetSources["firm"]>>,
    catalogs: async () =>
      (await ctx.read(catalogs, null)) as Awaited<ReturnType<DuctsSheetSources["catalogs"]>>,
    call: async (key, request, target, version, role) => {
      const value = await ctx.read(
        native,
        nativeInput.input.parse({
          key,
          request,
          target,
          ...(version ? { version } : {}),
          ...(role ? { role } : {}),
        }),
      );
      return Response.json(value.body, {
        headers: value.version ? { [DUCTS_BODY_VERSION_HEADER]: value.version } : {},
      });
    },
  };
}

export function fansInputPort(options: {
  source: DuctsSheetSources;
  workspace: RouteWorkspace;
  marks: HostMarks;
  run: NonNullable<DuctsSheetSources["inputs"]>["run"];
  evaluation: string;
  origin: () => unknown;
  revision: InputPort["revision"];
}): InputPort {
  return {
    evaluation: options.evaluation,
    get origin() {
      return options.origin();
    },
    revision: options.revision,
    take: async (name, raw) => {
      switch (name) {
        case "document-mark":
          await options.marks.settled?.();
          return options.run(options.marks.snapshot(fansReadArgs.shape.target.parse(raw)));
        case "work-scope":
          return options.source.workKey!(fansReadArgs.shape.target.parse(raw));
        case "work": {
          const { owner, scope } = z.object({ owner: z.string(), scope: workKeySchema }).parse(raw);
          return options.workspace.view(scope, owner, options.source.inputs?.work);
        }
        case "firm":
          return options.source.firm();
        case "catalogs":
          return options.source.catalogs();
        case "native": {
          const args = nativeInput.input.parse(raw);
          let response: Response;
          try {
            response = await options.source.call(
              args.key,
              args.request,
              args.target,
              args.version,
              args.role,
            );
          } catch (error) {
            if (
              (error instanceof BridgeError || error instanceof InputBridgeError) &&
              error.outcome === "refused"
            )
              throw new RefusedPartition(error.message);
            throw error;
          }
          if (!response.ok) throw Error(await response.text());
          return {
            body: await response.json(),
            version: response.headers.get(DUCTS_BODY_VERSION_HEADER),
          };
        }
        default:
          throw Error(`Unknown input leaf '${name}'`);
      }
    },
  };
}
