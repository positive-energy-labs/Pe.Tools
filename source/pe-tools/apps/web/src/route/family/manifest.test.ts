import { expect, test } from "vite-plus/test";

import { familyFixtures } from "#/family/authored-families";
import {
  FAMILY_DEMO_PODS,
  captureEvidence,
  familyManifest,
  familySpec,
  latestCaptureStatus,
} from "./manifest";

const target = { session: "s", openId: "family-a" };
const capture = (id: string, openId: string, startedAt: string) => ({
  kind: "workflow" as const,
  id,
  key: "family.capture",
  actor: "agent" as const,
  destination: { kind: "document" as const, ref: { session: "s", openId } },
  request: { pod: "demo" },
  bases: {},
  startedAt,
  publication: { state: "unrequested" as const },
  state: "succeeded" as const,
});

test("/family is one kernel definition: audit, capture, apply, with the build ceremony in audit", () => {
  const manifest = familyManifest();
  expect(familySpec).toMatchObject({
    capture: "family.capture",
    apply: "family.apply",
    needs: "document",
    specPicker: "always",
    schema: "/schemas/settings/FamilyFoundry/models.json",
  });
  expect(manifest.stages?.map((stage) => stage.key)).toEqual(["audit", "capture", "apply"]);
  expect(Object.keys(manifest.actions ?? {}).sort()).toEqual([
    "apply",
    "build",
    "cancel-build",
    "capture",
    "plan",
    "prepare-build",
  ]);
  expect(manifest.actions?.build.stage).toBe("audit");
});

test("every seed opens an authored fixture member of the demo pod at its stage", () => {
  const seeds = familyManifest().seeds ?? {};
  const members = FAMILY_DEMO_PODS[0]!.members.map((member) => member.path);
  expect(Object.keys(seeds).sort()).toEqual(["apply", "build", "capture"]);
  for (const [action, seed] of Object.entries(seeds)) {
    const page = seed!.page as { stage: string; pod: string; path: string };
    expect(page.pod).toBe("demo");
    expect(members).toContain(page.path);
    expect(page.stage).toBe(action === "build" ? "audit" : action);
    const profile = seed!.readings.profile as { rawContent: string; member: { path: string } };
    expect(profile.member.path).toBe(page.path);
    expect(Object.values(familyFixtures)).toContain(profile.rawContent);
  }
  // The apply seed opens on the confirmation sheet: the plan the first admission would return.
  expect(seeds.apply!.page).toMatchObject({
    confirming: true,
    sheet: { entries: [{ planHash: "demo-plan-grd", actions: 3, flag: null }] },
  });
});

test("capture evidence comes from the newest capture of this document and names its member", () => {
  const statuses = [
    capture("older", "family-a", "2026-09-17T01:00:00Z"),
    capture("elsewhere", "family-b", "2026-09-17T03:00:00Z"),
    capture("newest", "family-a", "2026-09-17T02:00:00Z"),
  ];
  expect(latestCaptureStatus(statuses, target)?.id).toBe("newest");
  const result = {
    member: { pod: "demo", path: "settings/family/Box.json", sha256: "a".repeat(64) },
    evidence: {
      reading: { at: "C:/Box.rfa", version: null, observedAt: "2026-09-17T02:00:00Z" },
      familyName: "Box",
      modelJson: "{}",
      unmodeledCount: 2,
      coverage: { parameters: "Full", geometry: "Partial" },
      issues: [],
      origin: "capture",
      rfaPath: null,
    },
  };
  expect(captureEvidence([{ id: "newest", result }], "newest")).toEqual(result);
  // A receipt that is not a finished capture carries no evidence.
  expect(captureEvidence([{ id: "newest", result: { members: [] } }], "newest")).toBeNull();
  expect(captureEvidence(undefined, "newest")).toBeNull();
});
