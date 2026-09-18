import { expect, test, vi } from "vite-plus/test";

const client = vi.hoisted(() => ({
  runSemanticAction: vi.fn(async (key: string, _input: unknown) => ({
    state: "succeeded",
    result: (key === "family.capture"
      ? { member: { pod: "p", path: "settings/family/box-saved.json", sha256: "b".repeat(64) } }
      : {
          plan: {
            familyId: 7,
            familyName: "box",
            planHash: "h",
            changes: [{ section: "parameters", key: "Width", kind: "set", mappedFrom: null }],
            runEffects: [],
            refusals: [],
            warnings: [],
          },
        }) as Record<string, unknown>,
  })),
}));
vi.mock("../../../../../packages/mcps/src/shared/takeoff-action-client", () => client);

import { familyDraftRouteState, settingsFieldPointer, type FamilyDraft } from "@pe/agent-contracts";

import { familyFixtures } from "#/family/authored-families";
import { draftSpec, familyManifest, familySpec } from "./manifest";

const width = settingsFieldPointer(["parameters", "Width", "value"]);
const reading = JSON.stringify({
  family: { name: "box" },
  parameters: { Width: { value: "1in" } },
});
const ctx = (doc: FamilyDraft, pod = "") => {
  const pages: object[] = [];
  return {
    pages,
    ctx: {
      target: { kind: "document", ref: { session: "s", openId: "o" } },
      work: { key: { route: "family", target: null }, doc, revision: 1 },
      readings: { pods: { state: "ready", observation: [] } },
      page: { stage: "audit", pod, path: "", selection: [], confirming: false, sheet: null },
      setPage: (next: object) => pages.push(next),
      write: vi.fn(async () => null),
    } as never,
  };
};

test("a staged family cell preserves the proposal and carries set/delete semantics", () => {
  const draft: FamilyDraft = {
    reading,
    cells: {
      [width]: {
        proposal: { value: "3in", by: "pea" },
        staged: { value: "2in" },
      },
    },
  };
  expect(JSON.parse(draftSpec(draft)!).parameters.Width.value).toBe("2in");
  expect(
    JSON.parse(
      draftSpec({ reading, cells: { [width]: { proposal: null, staged: { delete: true } } } })!,
    ).parameters.Width.value,
  ).toBeUndefined();
  expect(draft.cells[width]).toMatchObject({
    proposal: { value: "3in" },
    staged: { value: "2in" },
  });
});

test("family Work rejects legacy persisted arrays", () => {
  expect(() => familyDraftRouteState.schema.parse({ reading, edits: [], accepted: [] })).toThrow();
});

test("the live family reads into a draft with no pod: read needs none, capture asks for one", () => {
  const manifest = familyManifest();
  const { ctx: live } = ctx({ reading: familyFixtures.box, cells: {} });
  expect(manifest.actions!.read.ready(live, undefined as never)).toBeNull();
  expect(manifest.actions!.capture.ready(live, undefined as never)).toBe(
    "choose the pod the capture lands in",
  );
});

test("a staged cell plans: save files the draft as a member, the plan names it", async () => {
  client.runSemanticAction.mockClear();
  const doc: FamilyDraft = {
    reading,
    cells: { [width]: { proposal: null, staged: { value: "2in" } } },
  };
  const { ctx: c, pages } = ctx(doc, "p");
  expect(familySpec.staged!.count(c)).toBe(1);
  expect(familyManifest().actions!.plan.ready(c, undefined as never)).toBeNull();
  const sheet = await familySpec.staged!.plan(c);
  const [save, plan] = client.runSemanticAction.mock.calls;
  // Save is capture with the draft's text into the chosen pod; the host writes the member and run.
  expect(save![0]).toBe("family.capture");
  expect(save![1]).toMatchObject({ pod: "p" });
  expect(JSON.parse((save![1] as { spec: string }).spec).parameters.Width.value).toBe("2in");
  expect(plan![0]).toBe("family.plan");
  expect(plan![1]).toEqual({
    source: { pod: "p", path: "settings/family/box-saved.json", sha256: "b".repeat(64) },
  });
  expect(pages).toContainEqual({ path: "settings/family/box-saved.json" });
  expect(sheet.entries[0]).toMatchObject({
    planHash: "h",
    source: { path: "settings/family/box-saved.json" },
  });
});
