import { afterEach, describe, expect, it } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import type { RouteStateWriteResult } from "@pe/agent-contracts";

import { FAMILY_MODULE, type FamilyHost } from "#/family/host";
import { createFamilyStore } from "#/family/store";

const MODEL = {
  family: {
    name: "Test Family",
    category: "Generic Models",
    template: "Generic Model",
    placement: "Unhosted",
  },
  familyParameters: { Width: { dataType: "Length (Common)", value: "24in" } },
  types: { Standard: {} },
  planes: {},
  frames: {},
  solids: {},
  connectors: {},
};
const settings = (versionToken = "v1") => ({
  binding: { target: "session:test" },
  snapshot: {
    from: {
      target: "test",
      documentId: "C:\\Settings\\test.family.json",
      documentVersionToken: versionToken,
      observedAt: "2026-08-25T00:00:00Z",
      settingsDocumentId: {
        moduleKey: "FamilyFoundry",
        rootKey: "models",
        relativePath: "test.family.json",
      },
    },
    rawContent: JSON.stringify(MODEL),
    validation: { isValid: true, issues: [] },
  },
  fields: {},
});
const family = { binding: { target: "" }, doc: null, evidence: null };
const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => registries.splice(0).forEach((registry) => registry.dispose()));
const slice = <D>(doc: D) => ({
  doc,
  hydrated: true,
  connected: null,
  error: null,
  peaActive: false,
});
const fixture = () => {
  const calls: Array<{ op: string; input: unknown }> = [];
  const record = async (op: string, input: unknown): Promise<RouteStateWriteResult> => {
    calls.push({ op, input });
    return { ok: true, result: {} };
  };
  const host: FamilyHost = {
    sessions: async () => [
      {
        sessionId: "bridge-test",
        sdkSessionId: "test",
        processId: 42,
        lane: "dev",
        custody: "controlled",
        activeDocumentId: "C:\\Models\\Test.rfa",
        activeDocumentTitle: "Test.rfa",
        openDocumentCount: 1,
      },
    ],
    profile: async () => [],
    settingsApply: (patches) => record("settings.apply", patches),
    settingsCommand: (name, input) => record(`settings.${name}`, input ?? {}),
    familyApply: (patches) => record("family.apply", patches),
    familyCommand: (name, input) => record(`family.${name}`, input ?? {}),
  };
  return { host, calls };
};
const make = (testFixture = fixture(), profile = "") => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  const settingsSlice = Atom.make(AsyncResult.success(slice(settings())));
  const familySlice = Atom.make(AsyncResult.success(slice(family)));
  registries.push(registry);
  return {
    registry,
    settingsSlice,
    calls: testFixture.calls,
    store: createFamilyStore({
      registry,
      scope: { threadId: "thread-1" },
      host: testFixture.host,
      search: { target: "session:test", profile, patch() {} },
      slices: { settings: settingsSlice, family: familySlice },
    }),
  };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("family route store", () => {
  it("opens a direct URL profile once on mount without a verb failure", async () => {
    const { registry, store, calls } = make(fixture(), "pe-vav-test.json");
    await tick();
    expect(registry.get(store.atoms.failure)).toBeNull();
    expect(calls.filter(({ op }) => op === "settings.open")).toEqual([
      {
        op: "settings.open",
        input: { documentId: { ...FAMILY_MODULE, relativePath: "pe-vav-test.json" } },
      },
    ]);
  });

  it("does not reseed draft for a second slice snapshot with the same version token", () => {
    const { registry, settingsSlice, store } = make();
    store.actions.setDraft((draft) => ({
      ...draft,
      authored: { ...draft.authored, Width: "30in" },
      dirty: true,
    }));
    registry.set(settingsSlice, AsyncResult.success(slice({ ...settings(), savedAt: "later" })));
    expect(registry.get(store.atoms.draft).authored.Width).toBe("30in");
  });

  it("save stages the reverse-projection patches before the save command", async () => {
    const { store, calls } = make();
    await tick();
    store.actions.setDraft((draft) => ({
      ...draft,
      authored: { ...draft.authored, Width: "30in" },
      dirty: true,
    }));
    await store.actions.save();
    expect(calls).toEqual([
      {
        op: "settings.apply",
        input: [
          { path: ["fields", "/familyParameters/Width/value", "staged"], value: { value: "30in" } },
        ],
      },
      { op: "settings.save", input: {} },
    ]);
  });

  it("refuses build while capture is running", async () => {
    let release!: (value: { ok: true; result: {} }) => void;
    const testFixture = fixture();
    const host: FamilyHost = {
      ...testFixture.host,
      familyCommand: (
        name: "capture_evidence" | "build_evidence",
        input?: Record<string, unknown>,
      ) =>
        name === "capture_evidence"
          ? new Promise<{ ok: true; result: {} }>((resolve) => {
              release = resolve;
            })
          : testFixture.host.familyCommand(name, input),
    };
    const { store } = make({ ...testFixture, host });
    const capture = store.actions.capture();
    await tick();
    await expect(store.actions.build()).rejects.toThrow("another verb is running");
    release({ ok: true, result: {} });
    await capture;
  });

  it("records a failed open only on the core failure channel", async () => {
    const testFixture = fixture();
    const host: FamilyHost = {
      ...testFixture.host,
      settingsCommand: async () => {
        throw Error("open refused");
      },
    };
    const { registry, store } = make({ ...testFixture, host });
    await expect(store.actions.open("picked.family.json")).rejects.toThrow("open refused");
    expect(registry.get(store.atoms.failure)).toMatchObject({
      verb: "open",
      message: "open refused",
    });
    expect(registry.get(store.atoms.receipt)).toBeNull();
  });

  it("keeps capture on the core receipt channel", async () => {
    const { registry, store } = make();
    await store.actions.capture();
    expect(registry.get(store.atoms.receipt)).toMatchObject({ verb: "capture", text: "capture" });
  });

  it("latches an unknown build outcome in the store receipt", async () => {
    const { registry, store } = make();
    await tick();
    store.actions.armBuild();
    await store.actions.build();
    expect(registry.get(store.atoms.receipt)).toMatchObject({
      verb: "build",
      text: expect.stringContaining("OUTCOME UNKNOWN"),
    });
    expect(registry.get(store.atoms.armedBuild)).not.toBeNull();
  });

  it("projects feed initial, success, and failure states", async () => {
    let releaseSessions!: (value: []) => void;
    const testFixture = fixture();
    const host: FamilyHost = {
      ...testFixture.host,
      sessions: () =>
        new Promise<[]>((resolve) => {
          releaseSessions = resolve;
        }),
      profile: async () => {
        throw Error("tree refused");
      },
    };
    const { registry, store } = make({ ...testFixture, host });
    expect(registry.get(store.feeds.session).state).toBe("loading");
    releaseSessions([]);
    await tick();
    expect(registry.get(store.feeds.session).state).toBe("ready");
    await tick();
    expect(registry.get(store.feeds.profile).state).toBe("error");
  });
});
