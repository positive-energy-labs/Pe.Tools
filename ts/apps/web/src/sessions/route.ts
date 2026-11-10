import { z } from "zod";
import { route, field, paneLayout, type ContextOf } from "../route/defaults";
import { fields as openFields, loaded, module as open } from "../open/route";
import { draw } from "../route/draw";
export const fields = { ...openFields, session: field(z.string(), "", "pose", "push") };
export type SessionContext = ContextOf<typeof fields, typeof loaded>;
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
  commands: {
    start: open.spec.commands.start!,
    stop: open.spec.commands.stop!,
    restart: open.spec.commands.restart!,
  },
  panes: {
    sessions: {
      title: "Sessions",
      purpose: "Choose a running session or start a new one",
      draw: draw(() => import("./mount"), "SessionsBody"),
    },
  },
  layout: paneLayout("sessions"),
});
