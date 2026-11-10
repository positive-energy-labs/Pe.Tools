import {
  FAN_READ_MAX,
  ductsDesign,
  fansReadArgs,
  fansSheetData,
  openFanSheetSchema,
  stagedDucts,
  subjectCode,
  subjectOf,

} from "@pe/agent-contracts";
import { sheetSnapshot } from "@pe/ducts-domain/sheet/scoped-snapshot";
import { sheetState } from "@pe/ducts-domain/sheet/state";
import { z } from "zod";
import { designLayers } from "./ducts-design.ts";

import { read } from "./evaluator.ts";
import {
  ductSheet,
  fanElements,
  fanInputs,
  fanLegs,
  fanOverview,
  fanRoster,
  fanWorksheet,
  espOptions,
} from "./fan-sheet.ts";
const openFan = read("fans.open", {
  input: fansReadArgs
    .pick({ target: true, sheetPath: true })
    .extend({ unitId: z.number(), portIndex: z.number() }),
  output: openFanSheetSchema,
  async run(ctx, args) {
    const request = {
      target: args.target,
      mode: "fan" as const,
      unitId: args.unitId,
      portIndex: args.portIndex,
    };
    const overview = await ctx.read(fanOverview, request);
    const worst = (["supply", "return"] as const).flatMap((side) =>
      overview.totals?.[side].complete && overview.paths[side].paths[0]
        ? [overview.paths[side].paths[0]!.pathId]
        : [],
    );
    const paths = [...new Set([...worst, ...(args.sheetPath ? [args.sheetPath] : [])])];
    const inputs = await ctx.read(fanInputs, { ...request, basis: overview.basis }),
      elements = await ctx.read(fanElements, { ...request, basis: overview.basis }),
      worksheet = await ctx.read(fanWorksheet, { ...request, basis: overview.basis });
    const legs = await ctx.collect(paths, {
      read: fanLegs,
      batch: 1,
      args: ([pathId]) => ({
        ...request,
        basis: overview.basis,
        detail: { kind: "legs" as const, pathId: pathId! },
      }),
      covered: (value) => [value.pathId],
    });
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
    const fans = await ctx.read(fanRoster, { target: args.target });
    const chosen =
      args.fan === "all"
        ? fans.rows
        : [...new Set(args.fan)].map((key) => {
            const ref = subjectOf(key);
            const port = ref.sub && "port" in ref.sub ? ref.sub.port : null;
            const row = fans.rows.find(
              (row) => ref.keyKind === "UniqueId" && row.uniqueId === ref.key && row.portIndex === port,
            );
            if (!row) throw Error(`Fan '${key}' is unavailable; choose it from the roster`);
            return row;
          });
    const options = await ctx.read(espOptions, {
      target: args.target,
      units: chosen.flatMap((row) => (row.uniqueId ? [row.uniqueId] : [])),
    });
    if (chosen.length > FAN_READ_MAX) throw Error("Open at most 32 fan ports in one sheet");
    const opened = await ctx.collect(chosen, {
      read: openFan,
      batch: 1,
      key: (fan) => subjectCode({ keyKind: "UniqueId", key: fan.uniqueId, sub: { port: fan.portIndex } }),
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
    const { ducts: ductsDoc, fans: fansDoc } = await ctx.read(designLayers, args.target);
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
      ? await ctx.native("ducts.snapshot.walk", {
          role: "acquire",
          request: {
            slots: staged.parameters,
            labelParameter: staged.labelParameter ?? undefined,
            selector: { kind: "ids", ids },
          },
          target: { kind: "document", ref: args.target },
        })
      : null;
    return ctx.compute(fansSheetData, { opened, rows, fans, geometry }, (data) => ({
      ...options,
      open: data.opened[0] ?? null,
      opened: [...data.opened],
      rows: data.rows,
      progress: null,
      sheetView: fansSheetData.shape.sheetView.parse(sheetState(data.opened[0] ?? null)),
      design: fansSheetData.shape.design.parse(design),
      fans: { ...data.fans, rows: data.rows },
      ductsWork: ductsDoc,
      fansWork: fansDoc,
      sheetSnapshot: data.geometry
        ? {
            ...sheetSnapshot(data.geometry.body as Parameters<typeof sheetSnapshot>[0]),
            sourceVersion: data.geometry.version ?? undefined,
          }
        : { kind: "absent" },
    }));
  },
});

export const reads = { sheet: fansSheet, roster: fanRoster, pressureSheet: ductSheet };
