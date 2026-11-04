import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { z } from "zod";

import {
  neutralFansWork,
  stagedDucts,
  type DuctsSheetRequest,
  type DuctsSheetOverview,
} from "@pe/agent-contracts";

import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";

import { toGrids } from "@pe/ducts-domain/loss-grid";

import { TABLE_IDS } from "@pe/ducts-domain/pricing";

import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { callCompose, composeSource, ductsBodySource } from "#/shell/readings-api";
import { acquireSource } from "#/shell/readings-use";

import type { ReadingContext, DeriveSource, UseSource } from "#/shell/readings";

import { mergeSnapshots, nextSystemsRead, type NetworkSnapshot } from "./system-reads";

import type { entries } from "./neutral";
type ReadArgs = Partial<
  z.output<(typeof entries)["ducts.networks"]["input"]> &
    z.output<(typeof entries)["ducts.sheet"]["input"]> &
    z.output<(typeof entries)["ducts.sheet-snapshot"]["input"]>
>;
// Kernel gap: legacy ReadingContext erases catalog input types before sources run; type that single boundary after U1.
const args = (ctx: ReadingContext) => ctx.args as ReadArgs;

import { blockerElements } from "./sheet/layers";

import { detailOf } from "./sheet/tiers";

import { selectedFans, type Detail, type FanPort } from "./sheet/model";

import { EMPTY_SNAPSHOT, sheetSnapshot } from "./sheet/scoped-snapshot";

import type { OpenSheet, SheetReading, SnapshotReading } from "./neutral.ts";

/** Keep the native capture pin with the domain value; a JSON cache hash is not a native version. */
const captured = (source: UseSource<DuctSnapshot | null>): UseSource<SnapshotReading | null> => ({
  ...source,
  open(ctx, deliver) {
    return source.open(ctx, (frame) => {
      if ((frame.kind === "complete" || frame.kind === "part") && frame.value)
        deliver({ ...frame, value: { ...frame.value, sourceVersion: frame.sourceVersion } });
      else deliver(frame);
    });
  },
});

const target = (ctx: ReadingContext) => (ctx.target.kind === "document" ? ctx.target.ref : null);

const slots = (ctx: ReadingContext) => {
  const edit = stagedDucts(args(ctx).work ?? null, args(ctx).fanWork ?? neutralFansWork);

  return { slots: edit.parameters, labelParameter: edit.labelParameter ?? undefined };
};

const snapshotSchema = nativeResponseSchema("ducts.snapshot.walk");

function networks(): UseSource<NetworkSnapshot | null> {
  return {
    kind: "use",
    dirties: ["snapshot"],
    key: slots,

    async open(ctx, deliver) {
      const ref = target(ctx);

      if (!ref) return deliver({ kind: "complete", value: null, revision: 0 });

      const roster = args(ctx).roster ?? null;

      const authored = args(ctx).system ?? [];
      const names =
        authored === "all" ? (roster?.systems ?? []).map((system) => system.name) : authored;

      const wanted = [
        ...new Set(
          (roster?.systems ?? [])
            .filter((system) => names.includes(system.name))
            .map((system) => system.id),
        ),
      ];

      const unknown = names.filter(
        (name) => !roster?.systems.some((system) => system.name === name),
      );

      if (unknown.length)
        return deliver({
          kind: "failure",
          error: `System is not in this document: ${unknown.join(", ")}`,
        });

      if (!wanted.length)
        return deliver({
          kind: "complete",
          value: roster && { ...roster, systemReads: { completed: [], missing: [] } },
          revision: 0,
        });

      const parts: { snapshot: DuctSnapshot; version: string }[] = [];
      const completed = new Set<number>();
      const missing: number[] = [];
      let serial = 0;
      try {
        while (!ctx.signal.aborted) {
          const batch = nextSystemsRead(wanted, completed);
          if (!batch.length) return;
          const event = await acquireSource(
            ductsBodySource({
              request: () => ({
                kind: "ducts-snapshot",
                target: ref,
                ...slots(ctx),
                selector: { kind: "systems", systemIds: batch },
              }),
              decode: (value) => snapshotSchema.parse(value),
              absent: EMPTY_SNAPSHOT,
            }),
            ctx,
          );
          if (ctx.signal.aborted) return;
          parts.push({
            snapshot: event.value,
            version: event.sourceVersion ?? "",
          });
          for (const id of batch) completed.add(id);
          missing.push(
            ...batch.filter((id) => !event.value.systems.some((system) => system.id === id)),
          );
          deliver({
            kind: completed.size === wanted.length ? "complete" : "part",
            value: {
              ...mergeSnapshots(parts.map((part) => part.snapshot))!,
              systemReads: { completed: [...completed], missing: [...missing] },
              sourceVersion: parts.map((part) => part.version).join("+"),
            },
            revision: ++serial,
            sourceVersion: parts.map((part) => part.version).join("+"),
          });
        }
      } catch (error) {
        if (!ctx.signal.aborted) deliver({ kind: "failure", error });
      }
    },
  };
}

async function sheetDetail<K extends "inputs" | "elements" | "legs" | "worksheet">(
  ctx: ReadingContext,
  overview: DuctsSheetOverview,
  kind: K,
  pathId?: string,
): Promise<Detail<K>> {
  const result = await callCompose(ctx, "ducts.sheet", {
    body: {
      target: overview.target,
      mode: "fan",
      unitId: overview.fan!.unitId,
      portIndex: overview.fan!.portIndex,
      basis: overview.basis,
      detail: kind === "legs" ? { kind, pathId: pathId! } : { kind },
    },
  });

  if (result.kind !== kind || result.basis !== overview.basis)
    throw Error("Sheet detail does not match its overview");

  return result as Detail<K>;
}

function sheets(): UseSource<SheetReading> {
  return {
    kind: "use",
    dirties: ["snapshot"],

    async open(ctx, deliver) {
      const ref = target(ctx);

      const fans = args(ctx).fans ?? null;

      const empty: SheetReading = { open: null, rows: fans?.rows ?? [], progress: null };

      const keys = args(ctx).fan ?? [];
      let chosen: FanPort[];
      try {
        chosen = selectedFans(keys, fans?.rows ?? []);
      } catch (error) {
        return deliver({ kind: "failure", error });
      }
      if (!ref || !chosen.length) return deliver({ kind: "complete", value: empty, revision: 0 });
      const opened: OpenSheet[] = [];
      let serial = 0;

      try {
        let rows = [...empty.rows];

        for (const fan of chosen) {
          const request: DuctsSheetRequest = {
            target: ref,
            mode: "fan",
            unitId: fan.unitId,
            portIndex: fan.portIndex,
          };

          const result = await callCompose(ctx, "ducts.sheet", { body: request });

          if (result.kind !== "overview") throw Error("Expected a fan sheet overview");

          rows = rows.map((row) =>
            row.unitId === fan.unitId && row.portIndex === fan.portIndex
              ? {
                  ...row,
                  blockerCount: result.blockers.length,
                  requiredEspInWg: result.totals?.requiredEspInWg ?? null,
                  requiredEspAssumedInWg: result.totals?.requiredEspAssumedInWg ?? null,
                  complete: !!result.totals?.supply.complete && !!result.totals?.return.complete,
                }
              : row,
          );

          const worst = (["supply", "return"] as const).flatMap((side) =>
            result.totals?.[side].complete && result.paths[side].paths[0]
              ? [result.paths[side].paths[0]!.pathId]
              : [],
          );
          const paths = [
            ...new Set([
              ...worst,
              ...((args(ctx).sheetPath ?? "") ? [args(ctx).sheetPath ?? ""] : []),
            ]),
          ];
          const [inputs, elements, worksheet, ...legs] = await Promise.all([
            sheetDetail(ctx, result, "inputs"),
            sheetDetail(ctx, result, "elements"),
            sheetDetail(ctx, result, "worksheet"),
            ...paths.map((path) => sheetDetail(ctx, result, "legs", path)),
          ] as const);
          opened.push({
            overview: result,
            inputs,
            elements,
            worksheet,
            legs:
              legs[(args(ctx).sheetPath ?? "") ? paths.indexOf(args(ctx).sheetPath ?? "") : 0] ??
              null,
            worstLegs: legs.slice(0, worst.length),
          });
        }
        deliver({
          kind: "complete",
          value: { open: opened[0] ?? null, opened, rows, progress: null },
          revision: ++serial,
        });
      } catch (error) {
        if (ctx.signal.aborted) return;

        // Failed combined reads publish nothing: the previous ledger survives as non-current.
        deliver({ kind: "failure", error });
      }
    },
  };
}

export function ductsSources(): Readonly<Record<string, UseSource | DeriveSource>> {
  return {
    "ducts.meshes": { kind: "derive", derive: () => null },
    "ducts.roster": captured(
      ductsBodySource({
        request: (ctx) =>
          target(ctx)
            ? { kind: "ducts-snapshot", target: target(ctx)!, selector: { kind: "roster" } }
            : null,
        decode: (value) => snapshotSchema.parse(value),
        absent: null,
      }),
    ),

    "ducts.networks": networks(),

    "ducts.tables": ductsBodySource({
      request: (ctx) =>
        target(ctx)
          ? { kind: "ducts-tables", session: target(ctx)!.session, ids: [...TABLE_IDS] }
          : null,
      decode: toGrids,
      absent: null,
    }),

    "ducts.catalogs": {
      ...composeSource({
        key: "ducts.catalogs",
        input: () => ({}),
        absent: { tables: EMPTY_CATALOGS, findings: [] },
      }),
      dirties: ["snapshot"],
      effects: () => [],
    },

    "ducts.fans": {
      ...composeSource({
        key: "ducts.roster",
        input: (ctx) => (target(ctx) ? { body: { target: target(ctx)! } } : null),
        absent: null,
      }),
      dirties: ["snapshot"],
    },

    "ducts.sheet": sheets(),

    "ducts.sheet-snapshot": {
      ...captured(
        ductsBodySource({
          request: (ctx) => {
            const open = (args(ctx).sheet ?? undefined)?.open;

            if (!open?.overview.fan || !target(ctx)) return null;

            const blockers =
              open.inputs?.blockers ??
              [...open.overview.blockers, ...open.overview.assumedBlockers].map(detailOf);

            const opens = args(ctx).sheet?.opened ?? [open];
            const ids = [
              ...new Set([
                ...opens.flatMap((sheet) => [
                  sheet.overview.fan!.unitId,
                  ...(sheet.elements?.walkedElementIds ?? []),
                ]),
                ...(open.elements?.walkedElementIds ?? []),
                ...(open.elements?.beyond ?? []).flatMap((unit) => unit.elementIds),
                ...blockers.flatMap(blockerElements),
              ]),
            ].sort((a, b) => a - b);

            return {
              kind: "ducts-snapshot",
              target: target(ctx)!,
              ...slots(ctx),
              selector: { kind: "ids", ids },
            };
          },
          decode: (value) => sheetSnapshot(snapshotSchema.parse(value)),
          absent: EMPTY_SNAPSHOT,
        }),
      ),
      key: slots,
    },
  };
}
