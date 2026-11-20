import { implement, type CommandBody } from "@pe/host-internal/product";
import { product } from "@pe/rooms-contract/product";
import { readings } from "./readings.ts";
import { roomsExecutors } from "./rooms.ts";
import { takeoffExecutors } from "./takeoffs.ts";

type Key = keyof ReturnType<typeof roomsExecutors> | keyof ReturnType<typeof takeoffExecutors>;
// ponytail: each body builds its group's executors again; they hold no state. Split when one does.
const body =
  (key: Key): CommandBody =>
  (bridge, deps) =>
    ({ ...roomsExecutors(bridge, deps), ...takeoffExecutors(bridge, deps) })[key];

/** The host half of both routes: one body per declared reading and command. */
export const host = implement(product, {
  readings,
  commands: {
    "rooms.partition": body("rooms.partition"),
    "rooms.draw": body("rooms.draw"),
    "rooms.write": body("rooms.write"),
    "rooms.merge": body("rooms.merge"),
    "takeoffs.initialize": body("takeoffs.initialize"),
    "takeoffs.adopt": body("takeoffs.adopt"),
    "takeoffs.partition": body("takeoffs.partition"),
    "takeoffs.sync": body("takeoffs.sync"),
  },
});
/** What each route's host module serves. */
export const reads = host.reads;
