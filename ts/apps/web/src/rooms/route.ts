import { command } from "../route/typed-actions.ts";
import { bindings } from "./bindings";
import { read } from "../route/defaults";
import { paneLayout } from "../route/defaults";
import { z } from "zod";
import {
  roomsRouteState,
  routeStatePatchSchema,
  valueRead,
} from "@pe/agent-contracts";
import { roomsPageSchema } from "./page";
import { route, field } from "../route/defaults";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { roomsArgs, roomsData } from "@pe/agent-contracts";
const address = roomsPageSchema.shape;
export const fields = {
  stage: field(address.stage, "partition", "pose", "push"),
  view: field(address.view, "", "query", "push"),
  layers: field(address.layers, [], "pose"),
  show: field(address.show, "all", "query"),
  viewport: field(address.viewport, null, "pose"),
  picked: field(address.selected, [], "pose"),
};
export const loaded = read(hostRead(valueRead("rooms.workspace", roomsArgs, roomsData)), (page: { view: string }) => ({ view: page.view }));
export const edits = z.array(routeStatePatchSchema);
export type { Context as RoomsContext } from "./context.generated";
export const module = route({
  key: "rooms",
  name: "Rooms",
  needs: "project",
  host: "../../../host/src/reads/rooms.ts",
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
  core: loaded,
  fields,
  panes: {
    main: {
      title: "Rooms",
      purpose: "Choose a level and inspect its rooms",
      bindings,
      draw: draw(() => import("./mount"), "RoomsBody"),
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
  commands: {
    partition: {
      ...command("rooms.partition"),
      label: "Partition view",
      present: () => ({ sentence: "Partition the staged plan view", rows: [] }),
    },
    apply: {
      ...command("rooms.write"),
      label: "Write room fields",
      present: () => ({ sentence: "Write the staged room fields", rows: [] }),
    },
    merge: {
      ...command("rooms.merge"),
      label: "Merge rooms",
      present: () => ({ sentence: "Merge the staged room selection", rows: [] }),
    },
  },
  layout: paneLayout("main"),
});
