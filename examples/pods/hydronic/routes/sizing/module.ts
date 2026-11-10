import { z } from "zod";
import { valueRead } from "@pe/agent-contracts/value";
import { route, read, paneLayout, type ContextOf } from "@pe/web/route";
import { hostRead } from "@pe/web/host-read";
import { key, address, workState, edit, args, value } from "./schema.ts";

const core = read(hostRead(valueRead(`${key}.sizing`, args, value)));
// Builtins get this from a generated context file; a Pod names it once with the kernel's ContextOf.
type Context = ContextOf<{}, typeof core, typeof workState, typeof edit>;

export const module = route({
  key,
  address,
  name: "Hydronic pipe sizing",
  needs: "document",
  host: "./host.ts",
  directory: {
    group: "Calculate loads & airflow",
    summary: "Size each pipe of a hydronic system against velocity and friction limits",
    label: "Pipe sizing",
    icon: "Boxes",
    exposure: "Main",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: ["hydronic", "pipe", "diameter"],
    runtimeNeed: "Revit",
    listed: true,
    satellites: [],
  },
  fields: {},
  core,
  edits: {
    work: workState,
    seed: () => workState.schema.parse({}),
    owners: {},
    input: edit,
    patches: (input) => Object.entries(input).map(([name, v]) => ({ path: [name], value: v })),
    history: z.object({ label: z.string() }),
    describe: (detail) => ({ label: detail.label }),
  },
  panes: {
    sizing: {
      title: "Pipe sizing",
      purpose: "Which diameter each pipe should be, and which pipes are wrong today",
      // A Pod pane can only return text; the sheet, picture and goal slots draw the rest (gaps.json).
      draw: (ctx: Context) => {
        if (!ctx.value.current) return ctx.value.reason;
        const { limits, rows, unresolved, pumpHead } = ctx.value.value;
        return [
          `Limits: ${limits.maxVelocity} m/s, ${limits.maxFriction} Pa/m`,
          `Unresolved: ${unresolved.length}`,
          ...rows.map((r) => `${r.label}  ${r.flow ?? "no flow"} L/s  ${r.diameter} -> ${r.chosen ?? r.candidate ?? "none"} mm  ${r.status}`),
          `Pump head: ${pumpHead.greyed ? "(unresolved first)" : `${Math.round(pumpHead.pa ?? 0)} Pa`}`,
        ].join("\n");
      },
    },
  },
  layout: paneLayout("sizing"),
});
export const data = module.data;
