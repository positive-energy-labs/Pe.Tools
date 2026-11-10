import { z } from "zod";
import { valueRead } from "@pe/agent-contracts/value";
import { parameter, local } from "@pe/agent-contracts/slots";
import { route, read, field, split, type ContextOf } from "@pe/web/route";
import { hostRead } from "@pe/web/host-read";
import { key, address, workState, edit, args, value } from "./schema.ts";

const fields = { system: field(z.string(), "", "query") };
const core = read(hostRead(valueRead(`${key}.sizing`, args, value)), (page: { system: string }) => ({ system: page.system }));
// Builtins get this from a generated context file; a Pod names it once with the kernel's ContextOf.
type Context = ContextOf<typeof fields, typeof core, typeof workState, typeof edit>;

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
  fields,
  core,
  // The core is the Goal: the kernel draws its unresolved list first and greys the pump head until it is empty.
  goal: core,
  // `chosen` is the pipe's Diameter in Revit: sheet.plan reads it, sheet.apply writes it (ADR 0035 rule 3).
  sheet: {
    bindings: {
      chosen: parameter("Diameter", z.number().positive(), "Millimeters"),
      maxVelocity: local(z.number().positive()),
      maxFriction: local(z.number().positive()),
    },
  },
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
      // The sheet and goal slots draw the cells and the unresolved list; this pane is the sizing table.
      draw: (ctx: Context) => {
        if (!ctx.value.current) return ctx.value.reason;
        const { unresolved } = ctx.value.value;
        const { limits, rows, pumpHead } = ctx.value.value.result.value!;
        return [
          `Limits: ${limits.maxVelocity} m/s, ${limits.maxFriction} Pa/m`,
          `Unresolved: ${unresolved.length}`,
          ...rows.map((r) => `${r.label}  ${r.flow ?? "no flow"} L/s  ${r.diameter} -> ${r.chosen ?? r.candidate ?? "none"} mm  ${r.status}`),
          `Pump head: ${pumpHead.greyed ? "(unresolved first)" : `${Math.round(pumpHead.pa ?? 0)} Pa`}`,
        ].join("\n");
      },
    },
  },
  layout: split("h", ["goal", "sizing", "sheet"], { id: "sizing-layout", size: 320, sized: "start" }),
});
export const data = module.data;
