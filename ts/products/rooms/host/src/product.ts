import { implement, type CommandBody } from "@pe/host-internal/product";
import { product } from "@pe/rooms-contract/product";
import { calls, files, http, local } from "./bodies.ts";
import { readings } from "./readings.ts";
import { roomsExecutors, roomsSheet } from "./rooms.ts";
import { takeoffExecutors, type Deps } from "./takeoffs.ts";

type Key = keyof ReturnType<typeof roomsExecutors> | keyof ReturnType<typeof takeoffExecutors>;
// ponytail: each body builds its group's executors again; they hold no state. Split when one does.
const body =
  (key: Key): CommandBody<Deps> =>
  (bridge, deps) =>
    ({ ...roomsExecutors(bridge, deps), ...takeoffExecutors(bridge, deps) })[key];

/** The host half of both routes: one body per declared reading and command. */
export const host = implement<typeof product, Deps>(product, {
  readings,
  commands: {
    "rooms.partition": body("rooms.partition"),
    "rooms.draw": body("rooms.draw"),
    "rooms.merge": body("rooms.merge"),
    "takeoffs.adopt": body("takeoffs.adopt"),
    "takeoffs.partition": body("takeoffs.partition"),
    "takeoffs.sync": body("takeoffs.sync"),
    "sheet.plan": roomsSheet("sheet.plan"),
    "sheet.apply": roomsSheet("sheet.apply"),
  },
  http,
  local,
  files,
  calls,
});
/** What each route's host module serves. */
export const reads = host.reads;
