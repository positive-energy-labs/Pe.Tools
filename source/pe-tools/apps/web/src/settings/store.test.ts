import { afterEach, describe, expect, it } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  address,
  type RouteStatePatch,
  type SettingsDocumentId,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";

import {
  fixtureDocument,
  fixtureFiles,
  fixtureSnapshot,
  fixtureWorkspaces,
} from "#/settings-panes/fixture";
import { createSettingsStore } from "#/settings/store";

const stores: Array<ReturnType<typeof createSettingsStore>> = [];
const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.dispose());
  registries.splice(0).forEach((registry) => registry.dispose());
});

function make() {
  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  let document = structuredClone(fixtureDocument);
  const changed = Atom.make(0);
  const slice = Atom.make((get) => {
    get(changed);
    return AsyncResult.success({
      doc: document,
      hydrated: true,
      connected: true,
      error: null,
      peaActive: false,
    });
  });
  const applied: RouteStatePatch[][] = [];
  const opened: SettingsDocumentId[] = [];
  const apply = async (patches: RouteStatePatch[]) => {
    applied.push(patches);
    for (const patch of patches) {
      if (patch.path[0] === "bindings")
        document = {
          ...document,
          bindings: { ...document.bindings, [String(patch.path[1])]: patch.value as never },
        };
      if (patch.path[0] === "documentId")
        document = {
          ...document,
          documentId: (patch.value ?? null) as SettingsRouteDocument["documentId"],
        };
    }
    registry.update(changed, (value) => value + 1);
    return { ok: true as const, doc: document };
  };
  const store = createSettingsStore({
    registry,
    scope: { documentAddress: address(`C:\\Models\\settings-${registries.length}.rvt`) },
    slice,
    apply,
    command: async () => ({ ok: true }),
    host: {
      workspaces: async () => fixtureWorkspaces,
      tree: async () => fixtureFiles,
      schema: async () => "{}",
      open: async (documentId) => {
        opened.push(documentId);
        return { ...fixtureSnapshot, documentId };
      },
    },
  });
  stores.push(store);
  registries.push(registry);
  return { applied, opened, registry, store };
}

const waitForStage = () => new Promise<void>((resolve) => setTimeout(resolve, 180));

describe("settings route store", () => {
  it("opens a file without a world binding", async () => {
    const { opened, registry, store } = make();
    store.actions.setPicker({
      workspaceKey: "default",
      moduleKey: "CmdScheduleManager",
      rootKey: "schedules",
      filePath: fixtureFiles[0]!.path,
    });

    await store.actions.open();
    registry.get(store.atoms.snapshot);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(opened).toEqual([fixtureSnapshot.documentId, fixtureSnapshot.documentId]);
  });

  it("binds a picked file for refetch without clearing fields", async () => {
    const { applied, store } = make();
    store.actions.setPicker({
      workspaceKey: "default",
      moduleKey: "CmdScheduleManager",
      rootKey: "schedules",
      filePath: fixtureFiles[1]!.path,
    });

    await store.actions.bind(fixtureFiles[1]!.path);

    expect(applied[0]).toEqual([
      {
        path: ["bindings", "file"],
        value: expect.objectContaining({ id: fixtureFiles[1]!.path }),
      },
      {
        path: ["documentId"],
        value: {
          moduleKey: "CmdScheduleManager",
          rootKey: "schedules",
          relativePath: fixtureFiles[1]!.relativePath,
        },
      },
    ]);
  });

  it("debounces each field to one latest staged patch", async () => {
    const { applied, store } = make();

    void store.actions.stage("/Name", "first");
    void store.actions.stage("/Name", "latest");
    void store.actions.stage("/IsItemized", false);
    await waitForStage();

    expect(applied.flat()).toEqual(
      expect.arrayContaining([
        { path: ["fields", "/Name", "staged"], value: { value: "latest" } },
        { path: ["fields", "/IsItemized", "staged"], value: { value: false } },
      ]),
    );
  });

  it("flushes the latest staged value before save", async () => {
    const { applied, store } = make();
    void store.actions.stage("/Name", "saved immediately");

    await store.actions.save();

    expect(applied.flat()).toContainEqual({
      path: ["fields", "/Name", "staged"],
      value: { value: "saved immediately" },
    });
  });
});
