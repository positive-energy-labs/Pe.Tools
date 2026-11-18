import { expect, test } from "vite-plus/test";
import { ductsPricingReadResponse } from "@pe/duct-systems-contract/ducts-read";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { DUCT_UNIT_KINDS, FAN_BLOCKER_KINDS } from "@pe/host-contracts/generated";
import walk from "@pe/ducts-host/tests/native-recordings/driver-ducts.snapshot.walk.json" with { type: "json" };
import roster from "@pe/ducts-host/tests/native-recordings/driver-ducts.snapshot.roster.json" with { type: "json" };
import { fixture, ref } from "../../../../../apps/host/tests/host-read-graph.test-support.ts";

// These native recordings predate the generated vocabulary; preserve their model facts.
const vocabulary = { unitKinds: [...DUCT_UNIT_KINDS], blockerKinds: [...FAN_BLOCKER_KINDS] };
const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse({ ...walk, vocabulary });
const recordedRoster = nativeResponseSchema("ducts.snapshot.roster").parse({
  ...roster,
  vocabulary,
});

test.each([
  { name: "roster-only", system: [] as string[] },
  { name: "recorded walk", system: walk.systems.map((system) => system.name) },
])(
  "ducts.pricing decodes the $name without nesting host slot sources in the native snapshot",
  async ({ system }) => {
    const host = await fixture(false, { snapshot, roster: recordedRoster });
    try {
      const response = await host.probe({
        read: "ducts.pricing",
        subscription: "driver-jv3-real",
        generation: 0,
        args: { target: ref, system, fan: null },
      });
      expect(response.status).toBe(200);
      const publication = ductsPricingReadResponse.parse(await response.json());
      // DRIVER-JV3-SLOTS-CONTRACT: unrecognized_keys ["slotSources"] at ["survey", "snapshot"].
      expect(publication.state, publication.reason ?? "pricing publication").not.toBe(
        "refresh-needed",
      );
      expect(publication.value).not.toBeNull();
      const data = publication.value!.data;
      expect(data.network.slotSources).toBeDefined();
      expect(data.survey.snapshot).not.toHaveProperty("slotSources");
      if (system.length)
        expect(data.network.systemReads.completed).toEqual(walk.systems.map((system) => system.id));
    } finally {
      await host.close();
    }
  },
  60000,
);
