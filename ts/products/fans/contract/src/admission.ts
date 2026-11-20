import { fansDocumentSchema, fansRouteState, fanWriteScopeMessage } from "./fans.ts";
import { DUCT_SYSTEMS_ROUTE } from "@pe/ducts-contract/system-work";
import { z } from "zod";
import { workHandleSchema, workKey, type WorkHandle } from "@pe/agent-contracts";

const ductsRoute = DUCT_SYSTEMS_ROUTE,
  fansRoute = fansRouteState.route;

/** Product-owned preview prerequisites; the adapter supplies the shared Work read door. */
export const admissionPreflight = {
  routes: [ductsRoute, fansRoute],
  async run(
    input: Record<string, unknown>,
    asked: WorkHandle,
    read: (key: WorkHandle["key"]) => Promise<{ doc: unknown; handle: WorkHandle }>,
  ): Promise<void> {
    const siblings = z
      .strictObject({
        [ductsRoute]: workHandleSchema.optional(),
        [fansRoute]: workHandleSchema.optional(),
      })
      .optional()
      .parse(input.readWorks);
    const handle = asked.key.route === ductsRoute ? asked : siblings?.[ductsRoute];
    const fansHandle = asked.key.route === fansRoute ? asked : siblings?.[fansRoute];
    const ductsKey = handle?.key ?? { ...asked.key, route: ductsRoute };
    const [ducts, fans] = await Promise.all([
      read(ductsKey),
      read(fansHandle?.key ?? { ...ductsKey, route: fansRoute }),
    ]);
    const same = (a: WorkHandle, b: WorkHandle) =>
      workKey(a.key) === workKey(b.key) && a.revision === b.revision;
    if (handle && !same(ducts.handle, handle))
      throw Error("Ducts Work changed; read its current revision before preview");
    if (fansHandle && !same(fans.handle, fansHandle))
      throw Error("Fans Work changed; read its current revision before preview");
    if (
      asked.key.route === fansRoute &&
      !fansDocumentSchema.parse(fans.doc).writeIntent.edit?.value?.walk
    )
      throw Error(fanWriteScopeMessage);
  },
};
