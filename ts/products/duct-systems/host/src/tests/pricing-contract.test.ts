import { expect, test, vi } from "vite-plus/test";
import { ductsPricingReadResponse } from "@pe/duct-systems-contract/ducts-read";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { DUCT_UNIT_KINDS, FAN_BLOCKER_KINDS } from "@pe/host-contracts/generated";
import walk from "@pe/ducts-host/tests/native-recordings/driver-ducts.snapshot.walk.json" with { type: "json" };
import roster from "@pe/ducts-host/tests/native-recordings/driver-ducts.snapshot.roster.json" with { type: "json" };
import staged from "./recordings/driver-c2-jv3-read-pricing.json" with { type: "json" };
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, key, ref } from "../../../../../apps/host/tests/host-read-graph.test-support.ts";

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

// DRIVER-C2-JV3-CRITERION: on a copied model at 45c670d4 the read answered this request with the staged
// criterion in `ductSystemsWork` and `criteria.autoJoinGapIn` as value 5, source "firm". At base 0de20857
// this test fails the same way: expected { value: 9, source: "Work" }, received value 5, source "firm".
test("ducts.pricing resolves a staged Work criterion over the firm file, as the recorded request staged it", async () => {
  const recorded = staged.data;
  expect(recorded.criteria.autoJoinGapIn).toMatchObject({ value: 5, source: "firm" });
  const host = await fixture(false, { snapshot, roster: recordedRoster });
  try {
    // One firm home serves both readers, as on the real host: the firm file and the firm settings tier.
    vi.stubEnv("PE_TOOLS_SHARED_ROOT", host.dir);
    await writeFile(
      join(host.dir, "Settings", "ducts.json"),
      JSON.stringify(recorded.settings.ducts[0]!.json),
    );
    const patches = Object.entries(recorded.ductSystemsWork.criteria).map(([cell, { edit }]) => ({
      path: ["criteria", cell, "edit"],
      value: { value: edit.value },
    }));
    const saved = await host.workspace.apply(
      key("duct-systems"),
      "duct-systems",
      recorded.ductSystemsWork.criteria.autoJoinGapIn.edit.by as "human",
      patches,
      0,
    );
    expect(saved).toMatchObject({ ok: true });
    // The recorded target names the driver's own session; this host serves one document, at `ref`.
    const response = await host.probe({
      ...staged.request,
      args: { ...staged.request.args, target: ref },
    });
    expect(response.status).toBe(200);
    const data = ductsPricingReadResponse.parse(await response.json()).value!.data;
    expect(data.settings.ducts!.find((tier) => tier.tier === "firm")?.json).toMatchObject({
      criteria: { autoJoinGapIn: 5 },
    });
    expect(data.ductSystemsWork.criteria.autoJoinGapIn?.edit).toMatchObject({
      value: 9,
      by: "human",
    });
    expect(data.criteria.autoJoinGapIn).toMatchObject({
      value: data.ductSystemsWork.criteria.autoJoinGapIn!.edit!.value,
      source: "Work",
      author: "human",
      // The Work revision the read priced on, as `networkCalcs` versions its inputs.
      version: saved.ok ? saved.revision : null,
    });
  } finally {
    vi.unstubAllEnvs();
    await host.close();
  }
}, 60000);
