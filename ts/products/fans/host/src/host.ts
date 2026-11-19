import { native } from "@pe/agent-contracts/handle";
import * as contracts from "@pe/fans-contract/contract";
import { body } from "@pe/host-internal/read-graph";
import {
  FAN_READ_MAX,
  fansReadArgs,
  fansCalcData,
  openFanCalcSchema,
} from "@pe/fans-contract/fans-read";
import { ductsDesign, stagedDucts } from "@pe/duct-systems-contract/ducts";
import { subjectCode, subjectOf } from "@pe/agent-contracts";
import { calcSnapshot } from "@pe/ducts-domain/calc/scoped-snapshot";
import { calcState } from "@pe/fans-domain/calc/state";
import { z } from "zod";
import { designLayers } from "@pe/ducts-host/design-layers";
import { ductsInputs } from "@pe/ducts-host/ducts-input-acquisition";

import { read } from "@pe/host-internal/read-graph";
import {
  ductCalc,
  fanElements,
  fanInputs,
  fanLegs,
  fanOverview,
  fanRoster,
  fanCalcBreakdown,
} from "./fan-calc.ts";
const openFan = read("fans.open", {
  input: fansReadArgs
    .pick({ target: true, calcPath: true })
    .extend({ unitId: z.number(), portIndex: z.number() }),
  output: openFanCalcSchema,
  async run(ctx, args) {
    const request = {
      target: args.target,
      mode: "fan" as const,
      unitId: args.unitId,
      portIndex: args.portIndex,
    };
    const overview = await ctx.read(fanOverview, request);
    const worst = (["supply", "return"] as const).flatMap((side) =>
      // A side with a priced worst path has legs worth reading; whether the calc is complete is the claim's alone.
      overview.totals?.[side].worstPath != null && overview.paths[side].paths[0]
        ? [overview.paths[side].paths[0]!.pathId]
        : [],
    );
    const paths = [...new Set([...worst, ...(args.calcPath ? [args.calcPath] : [])])];
    const inputs = await ctx.read(fanInputs, { ...request, basis: overview.basis }),
      elements = await ctx.read(fanElements, { ...request, basis: overview.basis }),
      calcBreakdown = await ctx.read(fanCalcBreakdown, { ...request, basis: overview.basis });
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
      calcBreakdown,
      legs: legs[args.calcPath ? paths.indexOf(args.calcPath) : 0] ?? null,
      worstLegs: legs.slice(0, worst.length),
    };
  },
});

/** The Fans read owns the join; its adapter has no untracked Work/file/native access. */
export const fansCalc = body(contracts.calc, async function(ctx, args) {
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
    if (chosen.length > FAN_READ_MAX) throw Error("Open at most 32 fan ports in one sheet");
    const opened = await ctx.collect(chosen, {
      read: openFan,
      batch: 1,
      key: (fan) => subjectCode({ keyKind: "UniqueId", key: fan.uniqueId, sub: { port: fan.portIndex } }),
      args: ([fan]) => ({
        target: args.target,
        calcPath: args.calcPath,
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
            // The engine's claim is the only completeness (invariant 1); with none served, the row is not complete.
            complete: overview.claim?.kind === "complete",
          }
        : row;
    });
    const { ducts: ductsDoc, fans: fansDoc, revision: ductSystemsRevision, settings } = await ctx.read(designLayers, args.target);
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
    const flow = ids.length ? (await ctx.read(ductsInputs, args.target)).flow : null;
    const geometry = flow
      ? await ctx.read(native("ducts.snapshot.walk"), {
          role: "acquire",
          request: {
            slots: flow.slots,
            labelParameter: staged.labelParameter ?? undefined,
            selector: { kind: "ids", ids },
          },
          target: { kind: "document", ref: args.target },
        })
      : null;
    return ctx.compute(fansCalcData, { opened, rows, fans, geometry }, (data) => ({
      open: data.opened[0] ?? null,
      opened: [...data.opened],
      rows: data.rows,
      progress: null,
      calcView: fansCalcData.shape.calcView.parse(calcState(data.opened[0] ?? null)),
      design: fansCalcData.shape.design.parse(design),
      settings: { ducts: settings },
      fans: { ...data.fans, rows: data.rows },
      ductSystemsWork: ductsDoc,
      ductSystemsRevision,
      fansWork: fansDoc,
      calcSnapshot: data.geometry
        ? {
            ...calcSnapshot(data.geometry.body as Parameters<typeof calcSnapshot>[0]),
            sourceVersion: data.geometry.version ?? undefined,
            slotSources: flow?.slotSources,
          }
        : { kind: "absent" },
    }));
  });

export const reads = { calc: fansCalc, roster: fanRoster, calcDetail: ductCalc, calcBreakdown: fanCalcBreakdown };
