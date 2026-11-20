import { fansRouteState } from "./fans.ts";
import { DUCT_SYSTEMS_ROUTE } from "@pe/ducts-contract/system-work";
import { expect, test } from "vite-plus/test";
import { workHandle } from "@pe/agent-contracts";
import { admissionPreflight } from "./admission.ts";

test("P-096: preflight refuses a stale route-keyed sibling revision", async () => {
  const asked = workHandle({ binding: "host", route: fansRouteState.route, target: null }, 1);
  const sibling = workHandle({ ...asked.key, route: DUCT_SYSTEMS_ROUTE }, 1);
  await expect(
    admissionPreflight.run({ readWorks: { [sibling.key.route]: sibling } }, asked, async (key) => ({
      handle: workHandle(key, key.route === asked.key.route ? 1 : 2),
      doc: {
        writeIntent: { edit: { by: "human", value: { walk: { unitId: 100, portIndex: 0 } } } },
      },
    })),
  ).rejects.toThrow("Ducts Work changed; read its current revision before preview");
});

test("P-096: preflight refuses a renamed sibling key", async () => {
  const asked = workHandle({ binding: "host", route: fansRouteState.route, target: null }, 1);
  await expect(
    admissionPreflight.run({ readWorks: { ducts: asked } }, asked, async () => {
      throw Error("must not read");
    }),
  ).rejects.toThrow(/Unrecognized key/);
});
