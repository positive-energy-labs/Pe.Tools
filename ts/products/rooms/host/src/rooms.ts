/** The Rooms model writes. Each is one native leaf behind the carrier pattern of `takeoffs.ts`. */
import type { RevitBridge } from "@pe/host-internal/bridge";
import { command, refused } from "@pe/host-internal/command-executor";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { Effect } from "effect";
import { z } from "zod";
import { builtinCommands } from "@pe/agent-contracts/semantic-actions";
import type { CommandBody } from "@pe/host-internal/product";
import type { WorkKey } from "@pe/agent-contracts";
import { product, regionCode, regionId, stagedRegions } from "@pe/rooms-contract/product";
import {
  carrier,
  preparedCarrierSchema,
  replacing,
  runModel,
  sealCarrier,
  type Deps,
} from "./takeoffs.ts";

const { commands } = product;
const written = nativeResponseSchema("rooms.write");

// A one-shot write consumes its staged intent: a repeat needs a fresh one (no second native write).
export function roomsExecutors(bridge: RevitBridge["Service"], deps: Deps) {
  const { bind } = carrier(bridge, deps);
  return {
    "rooms.partition": command(commands["rooms.partition"], preparedCarrierSchema, {
      seal: sealCarrier,
      retires: () => [["writeIntent", "rooms.partition"]],
      bind: (ctx) => {
        const { view, rejected } = ctx.admission.input;
        return bind(ctx, "rooms.partition", [{ view, rejected, runId: ctx.admission.id }]);
      },
      run: (ctx, execution) =>
        runModel(ctx, execution, deps, bridge, null, (native) => {
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
    "rooms.draw": command(commands["rooms.draw"], preparedCarrierSchema, {
      seal: sealCarrier,
      retires: () => [["writeIntent", "rooms.draw"]],
      bind: (ctx) => {
        const { view, loops, name, role } = ctx.admission.input;
        return bind(ctx, "rooms.draw", [{ view, loops, name, role }]);
      },
      run: (ctx, execution) =>
        runModel(ctx, execution, deps, bridge, null, (native) => {
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
    "rooms.merge": command(commands["rooms.merge"], preparedCarrierSchema, {
      seal: sealCarrier,
      retires: () => [["writeIntent", "rooms.merge"]],
      bind: (ctx) => {
        const { view, regions, name } = ctx.admission.input;
        return bind(ctx, "rooms.merge", [{ view, uniqueIds: regions.map(regionId), name }]);
      },
      run: (ctx, execution) =>
        runModel(ctx, execution, deps, bridge, null, (native) => {
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

const sheetInput = z.looseObject({
  work: z.looseObject({ key: z.custom<WorkKey>((value) => value !== null && typeof value === "object") }),
  doc: z.unknown(),
});
/**
 * The Rooms body of the platform's sheet pair: the staged field cells of the admitted Work, one
 * native `rooms.write`. The plan reads the record replacements and writes nothing.
 */
export const roomsSheet =
  (key: "sheet.plan" | "sheet.apply"): CommandBody =>
  (bridge, deps) => {
    const { bind } = carrier(bridge, deps);
    const staged = (input: unknown) => stagedRegions(sheetInput.parse(input).doc).regions;
    return command(builtinCommands[key], preparedCarrierSchema, {
      seal: sealCarrier,
      bind: (ctx) => {
        const regions = staged(ctx.admission.input);
        if (!regions.length) throw refused("No room field is staged. Nothing was written.");
        return bind(ctx, "rooms.write", [{ regions }]);
      },
      run: (ctx, execution) => {
        const regions = staged(ctx.admission.input);
        // The plan answers with what it saw of the records, so the apply replaces exactly that.
        if (key === "sheet.plan")
          return Effect.succeed({ writes: regions, evidence: execution.prepared.replacement });
        const asked = new Map(regions.map((row) => [row.uniqueId, new Map(Object.entries(row))]));
        const { key: work } = sheetInput.parse(ctx.admission.input).work;
        return runModel(ctx, execution, deps, bridge, null, (native) =>
          Effect.gen(function* () {
            const value = yield* native("rooms.write", {
              regions,
              replacing: replacing(execution.prepared),
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
            return { ...z.record(z.string(), z.unknown()).parse(value), confirmed };
          }),
        );
      },
    });
  };
