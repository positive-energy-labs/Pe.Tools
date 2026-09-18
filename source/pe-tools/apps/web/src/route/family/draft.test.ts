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

import { settingsFieldPointer, type FamilyDraft } from "@pe/agent-contracts";

import { familyFixtures } from "#/family/authored-families";
import { draftSpec, familyManifest, familySpec, proposeOnDraft } from "./manifest";

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

test("a person's edit on a family parameter is an accept, and the draft spec carries it", () => {
  const draft = proposeOnDraft(
    { reading, edits: [{ pointer: width, value: "3in", by: "pea" }], accepted: [] },
    [{ path: ["fields", width, "staged"], value: { value: "2in" } }],
  );
  expect(draft.edits).toEqual([]);
  expect(draft.accepted).toEqual([{ pointer: width, value: "2in", by: "human" }]);
  expect(JSON.parse(draftSpec(draft)!).parameters.Width.value).toBe("2in");
  // A deny clears the proposal and accepts nothing.
  const denied = proposeOnDraft(
    { reading, edits: [{ pointer: width, value: "3in", by: "pea" }], accepted: [] },
    [{ path: ["fields", width, "proposal"] }],
  );
  expect(denied).toMatchObject({ edits: [], accepted: [] });
});

test("the live family reads into a draft with no pod: read needs none, capture asks for one", () => {
  const manifest = familyManifest();
  const { ctx: live } = ctx({ reading: familyFixtures.box, edits: [], accepted: [] });
  expect(manifest.actions!.read.ready(live, undefined as never)).toBeNull();
  expect(manifest.actions!.capture.ready(live, undefined as never)).toBe(
    "choose the pod the capture lands in",
  );
});

test("an accepted proposal plans: save files the draft as a member, the plan names it", async () => {
  client.runSemanticAction.mockClear();
  const doc: FamilyDraft = {
    reading,
    edits: [],
    accepted: [{ pointer: width, value: "2in", by: "human" }],
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
