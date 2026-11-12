import type { ContextOf } from "../route/defaults";
import { queryAction } from "../route/typed-actions.ts";
import { read } from "../route/defaults";
import { paneLayout } from "../route/defaults";
import { z } from "zod";
import { valueRead } from "@pe/agent-contracts";
import { route, field, subjectSchema, oneName } from "../route/defaults";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { opsArgs, opsData } from "@pe/agent-contracts";
import { opRead, receiptControlRpc } from "./actions";
/** The op is the subject (keyKind `name`, tuple `[op key]`); the receipt in view is route-owned query. */
export const fields = { op: field(subjectSchema(1), { kind: "ids", ids: [] }, "subject", "push") };
export const query = { actionId: field(z.string(), "", "query", "push") };
export const loaded = read(
  hostRead(valueRead("ops.workspace", opsArgs, opsData)),
  (page: { actionId: string }) => ({ actionId: page.actionId }),
);
export type OpsContext = ContextOf<typeof fields & typeof query, typeof loaded, never, never>;
export const module = route({
  key: "ops",
  name: "Ops",
  // This admin console is person-only; Pea runs operations through pe_do.
  agent: false,
  needs: "host",
  optionalTarget: "session",
  host: "./host.ts",
  directory: {
    label: "Host API",
    exposure: "Preview",
    group: "Explore / maintain",
    icon: "Terminal",
    runtimeNeed: "Host; Revit depends on the operation",
    summary: "Inspect catalog operations and original action receipts",
    aliases: ["host", "api", "operations", "playground"],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  fields,
  query,
  subject: {
    field: "op",
    noun: "operation",
    multiple: false,
    pane: "main",
    read: loaded,
    options: (data) =>
      (data?.catalog?.operations ?? []).map((entry) => ({ id: oneName(entry.key).ids[0]!, label: entry.displayName ?? entry.key })),
  },
  core: loaded,
  panes: {
    main: {
      title: "Ops",
      purpose: "Inspect requests, read results and control original receipts",
      body: "scroll",
      draw: draw("scroll", () => import("./mount"), "OpsBody"),
    },
  },
  commands: {
    // Both verbs take what only the pane holds (the request form, the receipt in view): `pane`.
    run: { ...queryAction(opRead), label: "Run read", pane: true, input: (_context, supplied) => supplied },
    control: {
      ...queryAction(receiptControlRpc),
      label: "Receipt control",
      pane: true,
      input: (_context, supplied) => supplied,
    },
  },
  layout: paneLayout("main"),
});
