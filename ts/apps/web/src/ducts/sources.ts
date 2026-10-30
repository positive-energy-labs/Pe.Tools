import { z } from "zod";

import {
  stagedDucts,
  ductsRosterResponseSchema,
  ductsSheetResponseSchema,
  type DuctsRouteDocument,
  type DuctsSheetRequest,
  type DuctsSheetOverview,
} from "@pe/agent-contracts";

import { EMPTY_CATALOGS, type Catalogs } from "@pe/ducts-domain/catalog";

import { toGrids } from "@pe/ducts-domain/loss-grid";

import { TABLE_IDS } from "@pe/ducts-domain/pricing";

import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { ductsBodySource, jsonSource, requestJson } from "#/shell/readings-api";

import type { ReadingContext, ReadingSource, UseSource } from "#/shell/readings";

import type { ReadingWorkerPort } from "#/shell/readings-worker";
import { workerSource } from "#/shell/readings-worker";

import { mergeSnapshots, nextSystemsRead } from "./system-reads";

import { applyPricingDelta, type PricingDelta } from "./pricing-delta";

import type { PricingInput, PricingResult, PricingPayload } from "./pricing-job";

import type { DuctsPage } from "./graph";

import { blockerElements } from "./sheet/layers";

import { detailOf } from "./sheet/tiers";

import type { Detail, FanPort } from "./sheet/model";

import { EMPTY_SNAPSHOT, sheetSnapshot } from "./sheet/scoped-snapshot";

export type OpenSheet = {
  overview: DuctsSheetOverview;

  inputs: Detail<"inputs"> | null;

  elements: Detail<"elements"> | null;

  legs: Detail<"legs"> | null;

  worstLegs: Detail<"legs">[];

  worksheet: Detail<"worksheet"> | null;
};

export type SheetReading = {
  open: OpenSheet | null;
  rows: FanPort[];
  progress: { done: number; total: number; mark: string; stopped: boolean } | null;
};

const target = (ctx: ReadingContext) => (ctx.target.kind === "document" ? ctx.target.ref : null);

const page = (ctx: ReadingContext) => ctx.page as DuctsPage;

const slots = (ctx: { work: unknown }) => {
  const edit = stagedDucts(ctx.work as DuctsRouteDocument | null);

  return { slots: edit.parameters, labelParameter: edit.labelParameter ?? undefined };
};

const saved: string | undefined = import.meta.env.DEV
  ? import.meta.env.VITE_DUCTS_FIXTURE
  : undefined;

const snapshotSchema = z.custom<DuctSnapshot>();

function networks(): UseSource<DuctSnapshot | null> {
  return {
    kind: "use",
    dirties: ["snapshot"],
    key: slots,

    async open(ctx, deliver) {
      const ref = target(ctx);

      if (!ref) return deliver({ kind: "complete", value: null, revision: 0 });

      if (saved)
        return jsonSource({
          request: () => ({ path: saved }),
          schema: snapshotSchema.nullable(),
          absent: null,
        }).open(ctx, deliver);

      const roster = ctx.inputs.roster?.value as DuctSnapshot | null;

      const names = page(ctx).system;

      const wanted = (roster?.systems ?? [])
        .filter((system) => page(ctx).readAll || names.includes(system.name))
        .map((system) => system.id);

      const unknown = names.filter(
        (name) => !roster?.systems.some((system) => system.name === name),
      );

      if (unknown.length)
        return deliver({
          kind: "failure",
          error: `System is not in this document: ${unknown.join(", ")}`,
        });

      if (!wanted.length) return deliver({ kind: "complete", value: roster, revision: 0 });

      const parts = new Map<string, { snapshot: DuctSnapshot; version: string; fresh: boolean }>();

      const started = new Set<number>();
      const completed = new Set<number>();

      const releases = new Set<() => void>();

      let serial = 0;

      const next = async () => {
        if (ctx.signal.aborted) return;

        const batch = nextSystemsRead(wanted, started);

        if (!batch.length) return;
        for (const id of batch) started.add(id);
        const batchKey = batch.join(",");

        const release = await ductsBodySource({
          request: () => ({
            kind: "ducts-snapshot",
            target: ref,
            ...slots(ctx),
            selector: { kind: "systems", systemIds: batch },
          }),

          decode: (value) => snapshotSchema.parse(value),
          absent: EMPTY_SNAPSHOT,
        }).open(ctx, (event) => {
          if (event.kind !== "complete") {
            const part = parts.get(batchKey);
            if (part) part.fresh = false;
            if (event.kind !== "part") deliver(event);

            return;
          }

          parts.set(batchKey, {
            snapshot: event.value,
            version: event.sourceVersion ?? "",
            fresh: true,
          });
          for (const id of batch) completed.add(id);

          const current = [...parts.values()];

          deliver({
            kind: completed.size === wanted.length ? "complete" : "part",
            value: mergeSnapshots(current.map((part) => part.snapshot)),
            revision: ++serial,
            sourceVersion: current.map((part) => part.version).join("+"),
            fresh: current.every((part) => part.fresh),
          });

          void next();
        });

        if (release) releases.add(release);
      };

      void next();

      return () => {
        for (const release of releases) release();
      };
    },
  };
}

async function sheetDetail<K extends "inputs" | "elements" | "legs" | "worksheet">(
  ctx: ReadingContext,
  overview: DuctsSheetOverview,
  kind: K,
  pathId?: string,
): Promise<Detail<K>> {
  const result = await requestJson(
    {
      path: "/pe/ducts/sheet",
      body: {
        target: overview.target,
        mode: "fan",
        unitId: overview.fan!.unitId,
        portIndex: overview.fan!.portIndex,
        basis: overview.basis,
        detail: kind === "legs" ? { kind, pathId } : { kind },
      },
    },
    ductsSheetResponseSchema,
    ctx.signal,
  );

  if (result.kind !== kind || result.basis !== overview.basis)
    throw Error("Sheet detail does not match its overview");

  return result as Detail<K>;
}

function sheets(): UseSource<SheetReading> {
  return {
    kind: "use",
    dirties: ["snapshot"],
    key: (scope) => scope.workRevision,

    async open(ctx, deliver) {
      const ref = target(ctx);

      const fans = ctx.inputs.fans?.value as z.output<typeof ductsRosterResponseSchema> | null;

      const empty: SheetReading = { open: null, rows: fans?.rows ?? [], progress: null };

      if (!ref || (!page(ctx).fanPort && !page(ctx).allFans))
        return deliver({ kind: "complete", value: empty, revision: 0 });

      let serial = 0;

      let base: DuctsSheetOverview | null = null;

      try {
        const chosen = page(ctx).allFans ? (fans?.rows ?? []) : [page(ctx).fanPort!];

        let rows = [...empty.rows];

        for (const [index, fan] of chosen.entries()) {
          const request: DuctsSheetRequest = {
            target: ref,
            mode: "fan",
            unitId: fan.unitId,
            portIndex: fan.portIndex,
          };

          const result = await requestJson(
            { path: "/pe/ducts/sheet", body: request },
            ductsSheetResponseSchema,
            ctx.signal,
          );

          if (result.kind !== "overview") throw Error("Expected a fan sheet overview");

          base = result;

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

          if (page(ctx).allFans)
            deliver({
              kind: "part",
              value: {
                open: null,
                rows,
                progress: {
                  done: index + 1,
                  total: chosen.length,
                  mark: "mark" in fan && typeof fan.mark === "string" ? fan.mark : "",
                  stopped: false,
                },
              },
              revision: ++serial,
            });
        }

        if (!base || page(ctx).allFans)
          return deliver({
            kind: "complete",
            value: {
              open: null,
              rows,
              progress: { done: chosen.length, total: chosen.length, mark: "", stopped: false },
            },
            revision: ++serial,
          });

        const worst = (["supply", "return"] as const).flatMap((side) =>
          base!.totals?.[side].complete && base!.paths[side].paths[0]
            ? [base!.paths[side].paths[0]!.pathId]
            : [],
        );

        const paths = [
          ...new Set([...worst, ...(page(ctx).sheetPath ? [page(ctx).sheetPath] : [])]),
        ];

        const [inputs, elements, worksheet, ...legs] = await Promise.all([
          sheetDetail(ctx, base, "inputs"),
          sheetDetail(ctx, base, "elements"),
          sheetDetail(ctx, base, "worksheet"),
          ...paths.map((path) => sheetDetail(ctx, base!, "legs", path)),
        ] as const);

        deliver({
          kind: "complete",
          value: {
            rows,
            progress: null,
            open: {
              overview: base,
              inputs,
              elements,
              worksheet,
              worstLegs: legs.slice(0, worst.length),
              legs: legs[page(ctx).sheetPath ? paths.indexOf(page(ctx).sheetPath) : 0] ?? null,
            },
          },
          revision: ++serial,
        });
      } catch (error) {
        if (ctx.signal.aborted) return;

        // Stale detail is an explicit boundary. A fresh overview may be inspected; old details never survive it.

        if (base && error instanceof Error && /stale sheet basis/i.test(error.message))
          deliver({
            kind: "part",
            value: {
              ...empty,
              open: {
                overview: base,
                inputs: null,
                elements: null,
                worksheet: null,
                worstLegs: [],
                legs: null,
              },
            },
            revision: ++serial,
          });

        deliver({ kind: "failure", error });
      }
    },
  };
}

export function ductsSources(): Readonly<Record<string, ReadingSource>> {
  return {
    "ducts.roster": ductsBodySource({
      request: (ctx) =>
        target(ctx)
          ? { kind: "ducts-snapshot", target: target(ctx)!, selector: { kind: "roster" } }
          : null,
      decode: (value) => snapshotSchema.parse(value),
      absent: null,
    }),

    "ducts.networks": networks(),

    "ducts.tables": saved
      ? jsonSource({
          request: () => ({ path: saved.replace(/[^/]*$/, "tables.json") }),
          schema: z.unknown().transform(toGrids),
          absent: null,
        })
      : ductsBodySource({
          request: (ctx) =>
            target(ctx)
              ? { kind: "ducts-tables", session: target(ctx)!.session, ids: [...TABLE_IDS] }
              : null,
          decode: toGrids,
          absent: null,
        }),

    "ducts.catalogs": {
      ...jsonSource({
        request: () => ({ path: "/pe/ducts/catalogs" }),
        schema: z.object({ tables: z.custom<Catalogs>(), findings: z.array(z.string()) }),
        absent: { tables: EMPTY_CATALOGS, findings: [] },
      }),
      dirties: ["snapshot"],
      effects: () => [],
    },

    "ducts.pricing": workerSource<PricingPayload, PricingResult, PricingDelta | null>({
      algorithmVersion: "ducts-pricing-v1",
      input: (ctx, previous) => {
        const same =
          previous &&
          ["ducts", "tables", "catalogs"].every(
            (id) => previous.inputs[id]!.value === ctx.inputs[id]!.value,
          );
        const base = same
          ? undefined
          : {
              snapshot: (ctx.inputs.ducts!.value as DuctSnapshot) ?? EMPTY_SNAPSHOT,
              grids: (ctx.inputs.tables!.value as PricingInput["grids"]) ?? {},
              catalogs: (ctx.inputs.catalogs!.value as { tables: Catalogs }).tables,
            };
        return { doc: ctx.work as DuctsRouteDocument | null, ...(base ? { base } : {}) };
      },
      spawn: () => {
        return new Worker(new URL("./pricing.worker.ts", import.meta.url), {
          type: "module",
        }) as unknown as ReadingWorkerPort<PricingPayload, PricingResult, PricingDelta | null>;
      },
      applyDelta: (before, delta) =>
        delta ? (applyPricingDelta(before, delta) as PricingResult) : before!,
    }),

    "ducts.fans": {
      ...jsonSource({
        request: (ctx) =>
          target(ctx) ? { path: "/pe/ducts/roster", body: { target: target(ctx) } } : null,
        schema: ductsRosterResponseSchema.nullable(),
        absent: null,
      }),
      dirties: ["snapshot"],
    },

    "ducts.sheet": sheets(),

    "ducts.sheet-snapshot": {
      ...ductsBodySource({
        request: (ctx) => {
          const open = (ctx.inputs.sheet?.value as SheetReading | undefined)?.open;

          if (!open?.overview.fan || !target(ctx)) return null;

          const blockers =
            open.inputs?.blockers ??
            [...open.overview.blockers, ...open.overview.assumedBlockers].map(detailOf);

          const ids = [
            ...new Set([
              open.overview.fan.unitId,
              ...(open.elements?.walkedElementIds ?? []),
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
      key: slots,
    },
  };
}
