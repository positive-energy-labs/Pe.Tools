import { familyDraftRouteState } from "@pe/agent-contracts";
import { familyFixtures } from "./authored-families";
import { FAMILY_DEMO_PODS, familyDemoFields } from "./seeds";
export const familySeeds = Object.fromEntries(
  Object.entries(familyFixtures).map(([name, rawContent]) => {
    const member = { pod: "demo", path: `settings/family/${name}.json` };
    return [
      name,
      {
        title: name,
        work: familyDraftRouteState.schema.parse({
          reading: rawContent,
          cells: familyDemoFields(rawContent),
        }),
        page: { ...member },
        queries: {
          "family.read": {
            reading: rawContent,
            takenAt: "2026-10-30T00:00:00Z",
            executionContext: { session: "fixture", openId: "family" },
            process: { pid: 1, processStartUtc: "2026-10-30T00:00:00Z", executable: "Fixture" },
          },
          "family.saved": null,
          "family.cancel-read": { cancelled: true },
        },
        readings: {
          profile: {
            member,
            rawContent,
            composedContent: rawContent,
            sha256: "fixture",
            observedAt: "2026-10-30T00:00:00Z",
            dependencies: [],
            validation: { isValid: true, issues: [] },
          },
          receipts: [],
          applyReceipt: [],
          captureReceipt: [],
          buildReceipt: [],
          spec: null,
          pods: FAMILY_DEMO_PODS,
        },
      },
    ];
  }),
);
