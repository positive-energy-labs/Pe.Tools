import { z } from "zod";
import { fansDocumentSchema, workHandleSchema, workKey, type WorkHandle } from "@pe/agent-contracts";

/** Product-owned preview prerequisites; the adapter supplies the shared Work read door. */
export const admissionPreflight = {
  routes: ["duct-systems", "fans"],
  async run(input: Record<string, unknown>, asked: WorkHandle,
    read: (key: WorkHandle["key"]) => Promise<{ doc: unknown; handle: WorkHandle }>): Promise<void> {
    const siblings = z.object({ ducts: workHandleSchema.optional(), fans: workHandleSchema.optional() }).optional().parse(input.readWorks);
    const handle = asked.key.route === "duct-systems" ? asked : siblings?.ducts;
    const fansHandle = asked.key.route === "fans" ? asked : siblings?.fans;
    const ductsKey = handle?.key ?? { ...asked.key, route: "duct-systems" };
    const [ducts, fans] = await Promise.all([read(ductsKey), read(fansHandle?.key ?? { ...ductsKey, route: "fans" })]);
    const same = (a: WorkHandle, b: WorkHandle) => workKey(a.key) === workKey(b.key) && a.revision === b.revision;
    if (handle && !same(ducts.handle, handle)) throw Error("Ducts Work changed; read its current revision before preview");
    if (fansHandle && !same(fans.handle, fansHandle)) throw Error("Fans Work changed; read its current revision before preview");
    const walk = fansDocumentSchema.parse(fans.doc).writeIntent.edit?.value?.walk;
    if (!walk)
      throw Error('Preview needs a fan walk. Read route:reads.value (read fans.roster), then stage writeIntent.edit = {"value":{"walk":{"unitId":<id>,"portIndex":<n>}}} in route:fans Work. Retry with the accepted Work revision. No preview was submitted.');
  },
};
