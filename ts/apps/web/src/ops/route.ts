import * as contracts from "./contract.ts";
import type { ContextOf, Verbs } from "../route/defaults";
import { handle } from "@pe/agent-contracts/handle";
import { read } from "../route/defaults";
import { paneLayout } from "../route/defaults";
import { z } from "zod";
import { route, field, subjectSchema, oneName } from "../route/defaults";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";

/** The op is the subject (keyKind `name`, tuple `[op key]`); the receipt in view is route-owned query. */
export const fields = { op: field(subjectSchema(1), { kind: "ids", ids: [] }, "subject", "push") };
export const query = { actionId: field(z.string(), "", "query", "push") };
export const loaded = read(
  hostRead(contracts.workspace),
  (page: { actionId: string }) => ({ actionId: page.actionId }),
);
export const receiptControls = ["action.read", "action.recover", "action.resume", "action.cancel"] as const;
export type OpsContext = ContextOf<typeof fields & typeof query, typeof loaded, never, never, Verbs<"run" | (typeof receiptControls)[number]>>;
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
      verbs: ["run", "action.read", "action.recover", "action.resume", "action.cancel"],
    },
  },
  verbs: {
    // Every verb takes what only the pane holds: the request form, or the receipt in view.
    run: { handle: handle("ops.read"), label: "Run read" },
    "action.read": { handle: handle("action.read"), label: "Read receipt" },
    "action.recover": { handle: handle("action.recover"), label: "Recover action" },
    "action.resume": { handle: handle("action.resume"), label: "Resume action" },
    "action.cancel": { handle: handle("action.cancel"), label: "Cancel action" },
  },
  layout: paneLayout("main"),
});
