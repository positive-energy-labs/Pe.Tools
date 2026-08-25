import { afterEach, describe, expect, it } from "vite-plus/test";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { createFixtureFamilyHost } from "#/family/host";
import { createFamilyStore } from "#/family/store";

const MODEL = {
  family: { name: "Test Family", category: "Generic Models", template: "Generic Model", placement: "Unhosted" },
  familyParameters: { Width: { dataType: "Length (Common)", value: "24in" } },
  types: { Standard: {} }, planes: {}, frames: {}, solids: {}, connectors: {},
};
const settings = (versionToken = "v1") => ({
  binding: { target: "" },
  snapshot: {
    documentId: { moduleKey: "FamilyFoundry", rootKey: "models", relativePath: "test.family.json" },
    rawContent: JSON.stringify(MODEL), versionToken, validation: { isValid: true, issues: [] },
  },
  fields: {},
});
const family = { binding: { target: "" }, doc: null, evidence: null };
const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => registries.splice(0).forEach((registry) => registry.dispose()));
const make = (host = createFixtureFamilyHost({ settings: settings(), family })) => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  registries.push(registry);
  return { registry, host, store: createFamilyStore({ registry, scope: { threadId: "thread-1" }, host, search: { target: "", patch() {} } }) };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("family route store", () => {
  it("does not reseed draft for a second slice snapshot with the same version token", () => {
    const { registry, store } = make();
    store.actions.setDraft((draft) => ({ ...draft, authored: { ...draft.authored, Width: "30in" }, dirty: true }));
    store.actions.acceptFixtureDocs({ ...settings(), savedAt: "later" }, family);
    expect(registry.get(store.atoms.draft).authored.Width).toBe("30in");
    expect(registry.get(store.atoms.seededRef)).toBe("test.family.json@v1");
  });

  it("save stages the reverse-projection patches before the save command", async () => {
    const { store, host } = make();
    store.actions.setDraft((draft) => ({ ...draft, authored: { ...draft.authored, Width: "30in" }, dirty: true }));
    await store.actions.save();
    expect(host.calls).toEqual([
      { op: "settings.apply", input: [{ path: ["fields", "/familyParameters/Width/value", "staged"], value: { value: "30in" } }] },
      { op: "settings.save", input: {} },
    ]);
  });

  it("refuses build while capture is running", async () => {
    let release!: (value: { ok: true; result: {} }) => void;
    const fixture = createFixtureFamilyHost({ settings: settings(), family });
    const host = {
      ...fixture,
      familyCommand: (name: "capture_evidence" | "build_evidence", input?: Record<string, unknown>) =>
        name === "capture_evidence"
          ? new Promise<{ ok: true; result: {} }>((resolve) => { release = resolve; })
          : fixture.familyCommand(name, input),
    };
    const { store } = make(host);
    const capture = store.actions.capture();
    await tick();
    await expect(store.actions.build("test.family.json")).rejects.toThrow("another verb is running");
    release({ ok: true, result: {} });
    await capture;
  });

  it("projects feed initial, success, and failure states", async () => {
    let releaseSessions!: (value: []) => void;
    const fixture = createFixtureFamilyHost({ settings: settings(), family });
    const host = {
      ...fixture,
      sessions: () => new Promise<[]>((resolve) => { releaseSessions = resolve; }),
      profile: async () => { throw Error("tree refused"); },
    };
    const { registry, store } = make(host);
    expect(registry.get(store.feeds.session).state).toBe("loading");
    releaseSessions([]);
    await tick();
    expect(registry.get(store.feeds.session).state).toBe("ready");
    await tick();
    expect(registry.get(store.feeds.profile).state).toBe("error");
  });
});
