/** The Rooms model writes. Each is one native leaf behind the replacement evidence of `takeoffs.ts`. */
import type { RevitBridge } from "@pe/host-internal/bridge";
import { command, nativeStep, refused } from "@pe/host-internal/command-executor";
import { nativeRequestSchema, nativeResponseSchema } from "@pe/host-contracts/decoders";
import { Effect } from "effect";
import { z } from "zod";
import { builtinCommands } from "@pe/agent-contracts/semantic-actions";
import type { CommandBody } from "@pe/host-internal/product";
import {
  product,
  regionCode,
  regionId,
  roomsWork,
  stagedRegions,
} from "@pe/rooms-contract/product";
import {
  replacementEvidence,
  preparedReplacementSchema,
  replacing,
  runModel,
  sealReplacement,
  type Deps,
} from "./takeoffs.ts";

const { commands } = product;
const written = nativeResponseSchema("rooms.write");

// A one-shot write consumes its staged intent: a repeat needs a fresh one (no second native write).
export function roomsExecutors(bridge: RevitBridge["Service"], deps: Deps) {
  const { bind } = replacementEvidence(bridge, deps);
  return {
    "rooms.partition": command(commands["rooms.partition"], preparedReplacementSchema, {
      seal: sealReplacement,
      retires: () => [["writeIntent", "rooms.partition"]],
      bind: (ctx) => {
        const { view, rejected } = ctx.admission.input;
        return bind(ctx, "rooms.partition", [{ view, rejected, runId: ctx.admission.id }]);
      },
      run: (ctx, execution) =>
        runModel(ctx, execution, deps, bridge, (native) => {
          const { view, rejected } = ctx.admission.input;
          return native("rooms.partition", {
            view,
            rejected,
            // The id of the plan, so a replayed apply names the same run.
            runId: ctx.admission.id,
            replacing: replacing(execution.prepared),
          });
        }),
    }),
    "rooms.draw": command(commands["rooms.draw"], preparedReplacementSchema, {
      seal: sealReplacement,
      retires: () => [["writeIntent", "rooms.draw"]],
      bind: (ctx) => {
        const { view, loops, name, role } = ctx.admission.input;
        return bind(ctx, "rooms.draw", [{ view, loops, name, role }]);
      },
      run: (ctx, execution) =>
        runModel(ctx, execution, deps, bridge, (native) => {
          const { view, loops, name, role } = ctx.admission.input;
          return native("rooms.draw", {
            view,
            loops,
            name,
            role,
            replacing: replacing(execution.prepared),
          });
        }),
    }),
    "rooms.merge": command(commands["rooms.merge"], preparedReplacementSchema, {
      seal: sealReplacement,
      retires: () => [["writeIntent", "rooms.merge"]],
      bind: (ctx) => {
        const { view, regions, name } = ctx.admission.input;
        return bind(ctx, "rooms.merge", [{ view, uniqueIds: regions.map(regionId), name }]);
      },
      run: (ctx, execution) =>
        runModel(ctx, execution, deps, bridge, (native) => {
          const { view, regions, name } = ctx.admission.input;
          return native("rooms.merge", {
            view,
            uniqueIds: regions.map(regionId),
            name,
            replacing: replacing(execution.prepared),
          });
        }),
    }),
  };
}

const sheetInput = builtinCommands["sheet.plan"].input
  .pick({ work: true })
  .extend({
    doc: roomsWork.schema,
  })
  .loose();
const preparedSheet = preparedReplacementSchema.extend({
  request: nativeRequestSchema("rooms.write"),
  refused: z.array(z.object({ uniqueId: z.string(), field: z.string(), reason: z.string() })),
});
/**
 * The Rooms body of the platform's sheet pair: the staged field cells of the admitted Work, one
 * native `rooms.write`. The plan reads the record replacements and writes nothing.
 */
export const roomsSheet =
  (key: "sheet.plan" | "sheet.apply"): CommandBody<Deps> =>
  (bridge, deps) => {
    const { bind } = replacementEvidence(bridge, deps);
    return command(builtinCommands[key], preparedSheet, {
      seal: ({ request, refused: held, ...prepared }) => ({
        request: { ...sealReplacement(prepared).request, ...request },
        evidence: { ...prepared.replacement, refused: held },
      }),
      bind: async (ctx) => {
        const { doc } = sheetInput.parse(ctx.admission.input);
        const { regions } = stagedRegions(doc);
        if (!regions.length) throw refused("No room field is staged. Nothing was written.");
        const bound = await bind(ctx, "rooms.write", [{ regions }]);
        return {
          ...bound,
          prepare: async () => {
            const prepared = await bound.prepare();
            const replacement = replacing(prepared);
            if (replacement)
              throw refused(
                `${replacement.reason}. Preview and apply rooms.draw, rooms.partition, or takeoffs.adopt to recover it.`,
                "sheet.plan-refused",
              );
            const { target } = ctx.admission;
            if (target.kind !== "document") throw refused("Exact document target required");
            const roster = await Effect.runPromise(
              nativeStep(bridge, target.ref, "rooms.roster", {}),
            );
            const { trackedRegionIds, unreadable } =
              nativeResponseSchema("rooms.roster").parse(roster);
            if (!trackedRegionIds)
              // The native reason as given: it names the recovery for a replaceable record and "update Pe" for a newer one.
              throw refused(
                unreadable?.[0]?.reason ?? "The Rooms record is unreadable.",
                "rooms.record-unreadable",
              );
            const tracked = new Set(trackedRegionIds);
            const held = regions.flatMap(({ uniqueId, ...values }) =>
              tracked.has(uniqueId)
                ? []
                : Object.keys(values).map((field) => ({
                    uniqueId,
                    field,
                    reason: "The region is missing from the document.",
                  })),
            );
            return {
              ...prepared,
              request: { regions: regions.filter(({ uniqueId }) => tracked.has(uniqueId)) },
              refused: held,
            };
          },
        };
      },
      run: (ctx, execution) => {
        const {
          request: { regions },
          refused: held,
        } = execution.prepared;
        if (key === "sheet.plan")
          return Effect.succeed({
            writes: regions,
            refused: held,
            evidence: execution.prepared.replacement,
            ...(!regions.length && {
              planRefusal: "All staged room fields are on missing regions. Remove them from Work.",
            }),
          });
        if (!regions.length)
          return Effect.fail(
            refused("All staged room fields are on missing regions. Remove them from Work."),
          );
        const asked = new Map(regions.map((row) => [row.uniqueId, new Map(Object.entries(row))]));
        const { key: work } = sheetInput.parse(ctx.admission.input).work;
        return runModel(ctx, execution, deps, bridge, (native) =>
          Effect.gen(function* () {
            const value = yield* native("rooms.write", {
              regions,
            });
            // Ruling 7: a cell retires only when the model answers with the value it was asked for.
            const confirmed = written
              .parse(value)
              .cells.filter((cell) => asked.get(cell.uniqueId)?.get(cell.field) === cell.value);
            // The sheet pair forwards no `retires`, so the body retires its own cells (as Fans does).
            if (confirmed.length)
              yield* execution.retireWork(
                work,
                work.route,
                confirmed.map((cell) => [cell.field, regionCode(cell.uniqueId)]),
              );
            return { ...z.record(z.string(), z.unknown()).parse(value), confirmed, refused: held };
          }),
        );
      },
    });
  };
