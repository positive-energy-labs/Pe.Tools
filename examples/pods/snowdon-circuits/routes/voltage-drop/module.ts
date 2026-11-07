import { z } from "zod";
import { valueRead } from "@pe/agent-contracts/value";
import { route, read, paneLayout } from "@pe/web/route";
import { hostRead } from "@pe/web/host-read";
import { key, initial, inputs, workState, args, value } from "./schema.ts";
export { initial };
export const module = route({
  key,
  address: `/tool/${encodeURIComponent("route:@snowdon-circuits/routes/voltage-drop/route.artifact")}`,
  name: "Circuit voltage drop",
  needs: "host",
  host: "./host.ts",
  directory: {
    group: "Calculate loads & airflow",
    summary: "Compare authored copper conductor inputs with the 75 C K method",
    label: "Circuits",
    icon: "Boxes",
    exposure: "Main",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: ["voltage", "conductor"],
    runtimeNeed: "Host",
    listed: true,
    satellites: [],
  },
  fields: {},
  core: read(hostRead(valueRead(`${key}.calculation`, args, value))),
  edits: {
    work: workState,
    seed: () => workState.schema.parse({}),
    owners: {},
    input: inputs,
    patches: (input) => [{ path: ["inputs"], value: input }],
    history: z.object({ label: z.string() }),
    describe: (detail) => ({ label: detail.label }),
  },
  panes: {
    calculation: {
      title: "Voltage drop",
      purpose: "Compare authored conductor inputs",
      draw: (ctx) =>
        ctx.value.current
          ? `Copper voltage-drop worksheet\nAuthored inputs\n${JSON.stringify(ctx.value.value, null, 2)}\nCopper K method at 75 C, unity power factor, negligible reactance. No model facts are inferred.`
          : ctx.value.reason,
    },
  },
  layout: paneLayout("calculation"),
});
export const data = module.data;
