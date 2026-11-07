import { z } from "zod";
import { valueRead } from "@pe/agent-contracts";
import { route, field, queryAction, type DrawContext } from "../route/typed-route";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { opsArgs, opsData } from "@pe/agent-contracts";
import { opRead, receiptControlRpc } from "./actions";
const fields = {
  op: field(z.string(), "", "query", "push"),
  actionId: field(z.string(), "", "query", "push"),
};
const loaded = {
  ...hostRead(valueRead("ops.workspace", opsArgs, opsData)),
  args: (page: { actionId: string }) => ({ actionId: page.actionId }),
};
export type OpsContext = DrawContext<z.output<typeof opsData>, typeof fields, never, never>;
export const module = route({
  key: "ops",
  name: "Ops",
  needs: "host",
  optionalTarget: "session",
  host: "../../../host/src/reads/ops.ts",
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
  core: loaded,
  panes: {
    main: {
      title: "Ops",
      purpose: "Inspect requests, read results and control original receipts",
      read: loaded,
      draw: draw(() => import("./mount"), "OpsBody"),
    },
  },
  commands: {
    run: { ...queryAction(opRead), label: "Run read", input: (_context, supplied) => supplied },
    control: {
      ...queryAction(receiptControlRpc),
      label: "Receipt control",
      input: (_context, supplied) => supplied,
    },
  },
  layout: { kind: "pane", id: "main" },
});
