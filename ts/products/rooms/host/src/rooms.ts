/** The four Rooms model writes. Each is one native leaf behind the carrier pattern of `takeoffs.ts`. */
import type { RevitBridge } from "@pe/host-internal/bridge";
import { command, refused } from "@pe/host-internal/command-executor";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { Effect } from "effect";
import { z } from "zod";
import { product, regionCode, regionId } from "@pe/rooms-contract/product";
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
    "rooms.write": command(commands["rooms.write"], preparedCarrierSchema, {
      seal: sealCarrier,
      bind: (ctx) => {
        const { regions } = ctx.admission.input;
        if (!regions.length) throw refused("No room field is staged. Nothing was written.");
        return bind(ctx, "rooms.write", [{ regions }]);
      },
      run: (ctx, execution) =>
        runModel(ctx, execution, deps, bridge, null, (native) => {
          const { regions } = ctx.admission.input;
          const asked = new Map(regions.map((row) => [row.uniqueId, new Map(Object.entries(row))]));
          return Effect.map(
            native("rooms.write", { regions, replacing: replacing(execution.prepared) }),
            (value) => ({
              ...z.record(z.string(), z.unknown()).parse(value),
              // Ruling 7: a cell retires only when the model answers with the value it was asked for.
              confirmed: written
                .parse(value)
                .cells.filter((cell) => asked.get(cell.uniqueId)?.get(cell.field) === cell.value),
            }),
          );
        }),
      retires: (result) =>
        written
          .parse({ cells: z.looseObject({ confirmed: z.unknown() }).parse(result).confirmed })
          .cells.map((cell) => [cell.field, regionCode(cell.uniqueId)]),
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
