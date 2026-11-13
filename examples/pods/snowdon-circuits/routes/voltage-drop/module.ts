import { calculation } from "./contract.ts";
import { z } from "zod";

import { route, read, paneLayout, scrollBody } from "@pe/web/route";
import { hostRead } from "@pe/web/host-read";
import { key, initial, inputs, workState } from "./schema.ts";
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
  core: read(hostRead(calculation)),
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
      body: "scroll",
      draw: (ctx) =>
        scrollBody(
          `Copper voltage-drop worksheet\nAuthored inputs\n${JSON.stringify(ctx.value.value, null, 2)}\nCopper K method at 75 C, unity power factor, negligible reactance. No model facts are inferred.`,
        ),
    },
  },
  layout: paneLayout("calculation"),
});
export const data = module.data;
