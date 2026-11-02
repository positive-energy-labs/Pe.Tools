import { z } from "zod";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { pane, split } from "@pe/agent-contracts";
import { openControls } from "../open/graph";
export const sessionsGraph: import("@pe/agent-contracts").RouteGraph<
  import("../open/graph").OpenPageState
> = {
  ...openControls,
  key: "session-admin",
  address: "session-admin",
  name: "Sessions",
  directory: {
    ...openControls.directory!,
    path: "/session-admin",
    title: "Sessions",
    blurb: "Start, stop or restart one Revit session.",
    aliases: ["session", "administration"],
  },
  subject: (p: { session: string }) => p.session || "Choose a session",
  subjectField: {
    field: "session",
    noun: "session",
    keyKind: "name",
    cardinality: "one",
    roster: "machine",
    detail: "machine",
    pane: "sessions",
    show: (id) => id,
  },
  fields: {
    ...openControls.fields,
    document: { ...openControls.fields.document, role: "selection" as const },
    session: {
      ...field(z.string().default(""), {}, { encode: String, decode: String }),
      role: "subject" as const,
    },
  },
  verbs: Object.fromEntries(
    Object.entries(openControls.verbs).filter(([id]) =>
      ["refresh", "start", "stop", "restart"].includes(id),
    ),
  ),
  panes: {
    sessions: {
      label: "Sessions",
      purpose: "Choose a running session or start a new one",
      draws: ["machine"],
      verbs: ["start"],
    },
    history: openControls.panes.history!,
  },
  layout: split(
    "session-body",
    { axis: "v", sized: "end", size: 140 },
    pane("sessions"),
    pane("history"),
  ),
  stages: {
    sessions: { word: "Managing sessions", panes: ["sessions", "history"], verbs: ["refresh"] },
  },
};
