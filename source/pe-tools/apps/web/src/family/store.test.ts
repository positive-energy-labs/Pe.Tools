import { afterEach, describe, expect, it } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  address,
  type FamilyDocument,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";

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
const SETTINGS_PATH = "C:\\Settings\\test.family.json";
const settings = (): SettingsRouteDocument => ({
  bindings: {
    file: { id: SETTINGS_PATH, label: SETTINGS_PATH },
  },
  documentId: {
    moduleKey: "FamilyFoundry",
    rootKey: "models",
    relativePath: "test.family.json",
  },
  fields: {},
});
const family = (evidence: FamilyDocument["evidence"] = null): FamilyDocument => ({
  bindings: {},
  doc: null,
  evidence,
});
const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => registries.splice(0).forEach((registry) => registry.dispose()));
const slice = <D>(doc: D) => ({
  doc,
  revision: 0,
  hydrated: true,
  connected: null,
  error: null,
  peaActive: false,
});
const fixture = () => {
  const calls: Array<{ op: string; input: unknown }> = [];
  const record = async (op: string, input: unknown): Promise<RouteStateWriteResult> => {
    calls.push({ op, input });
    return { ok: true, revision: 1, result: {} };
  };
  const host: FamilyHost = {
    sessions: async () =>
      ["test", "new"].map((id, index) => ({
        sessionId: `bridge-${id}`,
        sdkSessionId: id,
        processId: 42 + index,
        lane: "dev" as const,
        custody: "controlled" as const,
        activeDocumentId: `C:\\Models\\${id === "test" ? "Test" : "New"}.rfa`,
        activeDocumentTitle: `${id === "test" ? "Test" : "New"}.rfa`,
        openDocumentCount: 1,
      })),
    profile: async () => [],
    settings: async (documentId) => ({
      documentId,
      path: SETTINGS_PATH,
      versionToken: "v1",
      observedAt: "2026-08-25T00:00:00Z",
      rawContent: JSON.stringify(MODEL),
      composedContent: JSON.stringify(MODEL),
      validation: { isValid: true, issues: [] },
    }),
  };
  const writers = {
    settingsApply: (patches: RouteStatePatch[]) => record("settings.apply", patches),
    settingsCommand: (name: "open" | "save", input?: unknown) =>
      record(`settings.${name}`, input ?? {}),
    familyApply: (patches: RouteStatePatch[]) => record("family.apply", patches),
    familyCommand: (
      name: "capture_evidence" | "build_evidence" | "plan" | "apply",
      input?: unknown,
    ) => record(`family.${name}`, input ?? {}),
  };
  return { host, writers, calls };
};
const make = (
  testFixture = fixture(),
  _profile = "",
  settingsDocument = settings(),
  familyDocument = family(),
) => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  const settingsSlice = Atom.make(AsyncResult.success(slice(settingsDocument)));
  const familySlice = Atom.make(AsyncResult.success(slice(familyDocument)));
  registries.push(registry);
  return {
    registry,
    settingsSlice,
    familySlice,
    calls: testFixture.calls,
    store: createFamilyStore({
      registry,
      scope: {
        scope: {
          kind: "document" as const,
          document: address("C:\\Models\\Test.rfa"),
          pin: "test",
        },
      },
      host: testFixture.host,
      navigateTarget: async (target) => {
        testFixture.calls.push({ op: "navigate", input: target });
      },
      slices: { settings: Atom.make((get) => get(settingsSlice)), family: familySlice },
      writers: testFixture.writers,
    }),
  };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("family route store", () => {
  it("reads a newly selected profile without waiting for snapshot cache expiry", async () => {
    const { registry, settingsSlice, store } = make();
    await tick();
    const next = settings();
    next.documentId = { ...next.documentId!, relativePath: "another.family.json" };
    registry.set(settingsSlice, AsyncResult.success(slice(next)));
    await tick();
    expect(registry.get(store.atoms.snapshot)?.documentId.relativePath).toBe("another.family.json");
  });

  it("projects matching host settings without a world binding", async () => {
    const { registry, store } = make();
    registry.get(store.atoms.snapshot);
    await tick();

    expect(registry.get(store.atoms.snapshot)?.documentId).toEqual({
      moduleKey: "FamilyFoundry",
      rootKey: "models",
      relativePath: "test.family.json",
    });
  });

  it("projects matching evidence and binds another target without clearing it", async () => {
    const testFixture = fixture();
    const evidence: NonNullable<FamilyDocument["evidence"]> = {
      typeNames: [],
      parameters: [],
      diagnostics: [],
      reading: {
        at: address("C:\\Models\\Test.rfa"),
        version: "v1",
        observedAt: "2026-08-25T00:00:00Z",
      },
      origin: "build",
      familyName: "Test",
      rfaPath: "C:\\Models\\Test.rfa",
    };
    const { calls, registry, store } = make(testFixture, "", settings(), family(evidence));

    registry.get(store.atoms.lane);
    await tick();
    expect(registry.get(store.atoms.lane).world.live?.worldLabel).toBe("C:\\Models\\Test.rfa");

    // Binding another target is a navigation of the page Scope, never a document write.
    await store.actions.bind("new");

    expect(calls).toEqual([{ op: "navigate", input: "new" }]);
  });

  it("persists a picked profile before opening it", async () => {
    const { registry, store, calls } = make();
    await store.actions.open("pe-vav-test.json");
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
    let release!: (value: RouteStateWriteResult) => void;
    const testFixture = fixture();
    const writers = {
      ...testFixture.writers,
      familyCommand: (
        name: "capture_evidence" | "build_evidence" | "plan" | "apply",
        input?: unknown,
      ) =>
        name === "capture_evidence"
          ? new Promise<RouteStateWriteResult>((resolve) => {
              release = resolve;
            })
          : testFixture.writers.familyCommand(name, input),
    };
    const { store } = make({ ...testFixture, writers });
    const capture = store.actions.capture();
    await tick();
    await expect(store.actions.build()).rejects.toThrow("another verb is running");
    release({ ok: true, revision: 1, result: {} });
    await capture;
  });

  it("records a failed open only on the core failure channel", async () => {
    const testFixture = fixture();
    const writers = {
      ...testFixture.writers,
      settingsCommand: async () => {
        throw Error("open refused");
      },
    };
    const { registry, store } = make({ ...testFixture, writers });
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

  it("keeps a refused build in the build strip outcome", async () => {
    const testFixture = fixture();
    const writers = {
      ...testFixture.writers,
      familyCommand: async () =>
        ({
          ok: false,
          kind: "refused",
          error: "build moved",
          hint: "re-read",
        }) satisfies RouteStateWriteResult,
    };
    const { registry, store } = make({ ...testFixture, writers });
    await tick();
    store.actions.armBuild();

    await expect(store.actions.build()).rejects.toThrow("build moved: re-read");
    expect(registry.get(store.atoms.buildOutcome)).toEqual({
      code: "host",
      says: "build moved: re-read",
    });
  });

  it("projects profile feed failures", async () => {
    const testFixture = fixture();
    const host: FamilyHost = {
      ...testFixture.host,
      profile: async () => {
        throw Error("tree refused");
      },
    };
    const { registry, store } = make({ ...testFixture, host });
    await tick();
    expect(registry.get(store.feeds.profile).state).toBe("error");
  });
});

it("preserves unsaved authored edits when target navigation is requested", async () => {
  const { registry, store, calls } = make();
  registry.get(store.atoms.lane);
  await tick();
  store.actions.setDraft((d) => ({ ...d, authored: { ...d.authored, Width: "42in" } }));
  await expect(store.actions.bind("new")).rejects.toThrow("Save or resolve authored edits");
  expect(calls.filter((c) => c.op === "navigate")).toEqual([]);
  expect(registry.get(store.atoms.draft).authored.Width).toBe("42in");
});

it.each([
  { $preset: "@global/_parameters/base" },
  { $include: ["@global/_parameters/base", "@global/_parameters/later"] },
])(
  "keeps inherited edits out of the local draft and leaves shared navigation available: %j",
  async (directive) => {
    const f = fixture();
    const documentId = {
      moduleKey: "Global",
      rootKey: "fragments",
      relativePath: "_parameters/base",
    };
    const { familyParameters, ...rest } = MODEL;
    const host: FamilyHost = {
      ...f.host,
      settings: async (id) => ({
        ...(await f.host.settings(id)),
        rawContent: JSON.stringify({ ...rest, parameters: directive }),
        composedContent: JSON.stringify({ ...rest, parameters: familyParameters }),
        dependencies: [{ directivePath: "@global/_parameters/base", documentId }],
      }),
    };
    const { registry, store, calls } = make({ ...f, host });
    registry.get(store.atoms.lane);
    await tick();
    const before = registry.get(store.atoms.draft);
    expect(
      store.actions.setDraft((d) => ({ ...d, authored: { ...d.authored, Width: "42in" } })),
    ).toContain("Edit the shared source");
    expect(registry.get(store.atoms.draft)).toBe(before);
    expect(registry.get(store.atoms.sharedEdit)?.pointer).toBe("/parameters/Width/value");
    expect(calls).toEqual([]);
    await store.actions.openShared(documentId);
    expect(calls).toEqual([{ op: "settings.open", input: { documentId } }]);
    // An explicitly authored type cell is still local even when its default is inherited.
    store.actions.setDraft((d) => ({ ...d, types: { ...d.types, Standard: { Width: "36in" } } }));
    expect(registry.get(store.atoms.draft).types.Standard?.Width).toBe("36in");
  },
);
