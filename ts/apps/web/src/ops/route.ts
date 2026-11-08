import { queryAction } from "../route/typed-actions.ts";
import { read } from "../route/defaults";
import { paneLayout } from "../route/defaults";
import { z } from "zod";
import { valueRead } from "@pe/agent-contracts";
import { route, field } from "../route/defaults";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { opsArgs, opsData } from "@pe/agent-contracts";
import { opRead, receiptControlRpc } from "./actions";
export const fields = {
  op: field(z.string(), "", "query", "push"),
  actionId: field(z.string(), "", "query", "push"),
};
export const loaded = read(
  hostRead(valueRead("ops.workspace", opsArgs, opsData)),
  (page: { actionId: string }) => ({ actionId: page.actionId }),
);
export type { Context as OpsContext } from "./context.generated";
export const module = route({
  key: "ops",
  name: "Ops",
  // This admin console is person-only; Pea runs operations through pe_do.
  agent: false,
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
  layout: paneLayout("main"),
});
