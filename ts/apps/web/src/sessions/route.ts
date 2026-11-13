import { z } from "zod";
import { route, field, paneLayout, type ContextOf, type Verbs } from "../route/defaults";
import { handle } from "@pe/agent-contracts/handle";
import { fields as openFields, loaded } from "../machine/open-fields";
import { module as open } from "../open/route";
import { draw } from "../route/draw";
export const fields = { ...openFields, session: field(z.string(), "", "pose", "push") };
export type SessionContext = ContextOf<typeof fields, typeof loaded, never, never, Verbs<"start" | "stop" | "restart">>;
export const module = route({
  key: "session-admin",
  name: "Sessions",
  needs: "host",
  directory: {
    ...open.spec.directory,
    label: "Sessions",
    summary: "Start, stop or restart one Revit session.",
    aliases: ["session", "administration"],
  },
  fields,
  core: loaded,
  verbs: {
    start: { handle: handle("instances.start"), label: "Start Revit and open" },
    stop: { handle: handle("instances.stop"), label: "Stop Revit" },
    restart: { handle: handle("instances.restart"), label: "Hot reload Revit" },
  },
  panes: {
    sessions: {
      title: "Sessions",
      purpose: "Choose a running session or start a new one",
      body: "scroll",
      draw: draw("scroll", () => import("./mount"), "SessionsBody"),
      verbs: ["start", "stop", "restart"],
    },
  },
  layout: paneLayout("sessions"),
});
