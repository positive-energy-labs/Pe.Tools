import * as contracts from "./contract.ts";
import type { ContextOf } from "@pe/web-kernel/route";
import { handle } from "@pe/agent-contracts/handle";
import { bindings } from "./bindings";
import { read } from "@pe/web-kernel/route";
import { z } from "zod";
import { roomsRouteState, routeStatePatchSchema } from "@pe/agent-contracts";
import { roomsPageSchema } from "./page";
import { route, field } from "@pe/web-kernel/route";
import { hostRead } from "@pe/web-kernel/host-read";
import { draw } from "@pe/web-kernel/route/draw";

import { split, subjectSchema } from "@pe/web-kernel/route";
import { levelOrder, regionCode, roomRows, type RoomsRegion } from "./rows.ts";
const address = roomsPageSchema.shape;
/** The rooms a person or Pea may hold open at once; "all" is the whole roster. */
const room = subjectSchema(512);
/*
 * Slice 10 (MAP row 10): the room is the subject, the level and view are route-owned query, and the plan's own
 * pose (its solver layers and its plane camera) stays in `fields`: the kernel's picture pose is the
 * 3D scene's (`route/slots/picture/pose.ts`), and no pane draws from the picture slot yet.
 */
export const fields = {
  room: field(room, { kind: "ids", ids: [] }, "subject", "push"),
  stage: field(address.stage, "partition", "stage", "push"),
  layers: field(address.layers, [], "pose"),
  viewport: field(address.viewport, null, "pose"),
  // The feedback mark pinned on the plan; empty pins the first mark of the picked rooms.
  card: field(z.string(), "", "pose"),
};
export const query = {
  view: field(address.view, null, "query", "push"),
  level: field(address.level, "", "query", "push"),
};
export const loaded = read(hostRead(contracts.workspace), (page: { view: number | null }) => ({
  view: page.view,
}));
export const edits = z.array(routeStatePatchSchema);
export type RoomsContext = ContextOf<
  typeof fields & typeof query,
  typeof loaded,
  typeof import("@pe/agent-contracts").roomsRouteState,
  typeof edits
>;
export const module = route({
  key: "rooms",
  name: "Rooms",
  needs: "project",
  documentFields: ["view", "level", "room", "viewport", "card"],
  host: "./host.ts",
  directory: {
    label: "Manual J",
    exposure: "Preview",
    group: "Calculate loads & airflow",
    icon: "LayoutDashboard",
    runtimeNeed: "Revit for room plans and writes",
    summary: "Inspect room regions, stage loads and review anchored feedback",
    aliases: ["manual", "j", "loads", "regions"],
    listed: true,
    satellites: [],
    resume: "document",
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  subject: {
    field: "room",
    noun: "room",
    pane: "main",
    read: loaded,
    options: (data) =>
      roomRows(
        data.snapshot.regions as readonly RoomsRegion[],
        levelOrder(data.snapshot.levels),
      ).map((row) => ({
        id: regionCode(row.region.guid),
        label: `${row.label} · ${row.region.level}`,
      })),
  },
  core: loaded,
  // The core read is the Goal: the partition inbox, what is left on the chosen view (`./goal.ts`).
  goal: loaded,
  fields,
  query,
  panes: {
    main: {
      title: "Rooms",
      purpose: "Choose a level, inspect its rooms and mark the plan",
      bindings,
      body: "fill",
      draw: draw("fill", () => import("./mount"), "RoomsBody"),
    },
  },
  edits: {
    work: roomsRouteState,
    seed: () => roomsRouteState.schema.parse({}),
    value: "roomsWork",
    owners: {},
    input: edits,
    patches: (input) => input,
    history: z.object({ label: z.string() }),
    describe: (history) => ({ label: history.label }),
  },
  verbs: {
    partition: {
      handle: handle("rooms.partition"),
      label: "Partition view",
      present: () => ({ sentence: "Partition the staged plan view", rows: [] }),
    },
    apply: {
      handle: handle("rooms.write"),
      label: "Write room fields",
      present: () => ({ sentence: "Write the staged room fields", rows: [] }),
    },
    merge: {
      handle: handle("rooms.merge"),
      label: "Merge rooms",
      present: () => ({ sentence: "Merge the staged room selection", rows: [] }),
    },
  },
  band: ["partition", "apply", "merge"],
  layout: split("h", ["main", "goal"], { id: "rooms-main", size: 320, sized: "end" }),
});
