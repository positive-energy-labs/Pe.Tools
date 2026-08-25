import { afterEach, describe, expect, it } from "vite-plus/test";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import type { RouteStatePatch, RouteStateWriteResult } from "@pe/agent-contracts";

import { createFixtureSettingsHost } from "#/settings-panes/fixture-route";
import type { SettingsHost } from "#/settings/host";
import { createSettingsStore } from "#/settings/store";

const stores: Array<ReturnType<typeof createSettingsStore>> = [];
const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.dispose());
  registries.splice(0).forEach((registry) => registry.dispose());
});

function make(transform?: (host: SettingsHost) => SettingsHost) {
  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  const fixture = createFixtureSettingsHost(registry);
  const host = transform?.(fixture) ?? fixture;
  const store = createSettingsStore({
    registry,
    scope: { threadId: `settings-${registries.length}` },
    host,
    search: { source: "fixture" },
  });
  stores.push(store);
  registries.push(registry);
  return { registry, store };
}

const waitForStage = () => new Promise<void>((resolve) => setTimeout(resolve, 180));

describe("settings route store", () => {
  it("debounces each field to one latest staged patch", async () => {
    const calls: RouteStatePatch[][] = [];
    const { store } = make((fixture) => ({
      ...fixture,
      async apply(patches) {
        calls.push(patches);
        return fixture.apply!(patches);
      },
    }));

    void store.actions.stage("/Name", "first");
    void store.actions.stage("/Name", "latest");
    void store.actions.stage("/IsItemized", false);
    await waitForStage();

    expect(calls).toHaveLength(2);
    expect(calls.flat()).toEqual(expect.arrayContaining([
      { path: ["fields", "/Name", "staged"], value: { value: "latest" } },
      { path: ["fields", "/IsItemized", "staged"], value: { value: false } },
    ]));
  });

  it("flushes the latest staged value before save", async () => {
    const calls: string[] = [];
    const { store } = make((fixture) => ({
      ...fixture,
      async apply(patches) {
        calls.push(`apply:${String(patches[0]?.value && (patches[0].value as { value?: unknown }).value)}`);
        return fixture.apply!(patches);
      },
      async command(name, input) {
        calls.push(name);
        return name === "save" ? { ok: true } : fixture.command!(name, input);
      },
    }));
    void store.actions.stage("/Name", "saved immediately");

    await store.actions.save();

    expect(calls).toEqual(["apply:saved immediately", "save"]);
  });

  it("reports staging rejection through the route failure atom", async () => {
    const { registry, store } = make((fixture) => ({
      ...fixture,
      apply: async () => ({ ok: false, error: "stage rejected" }),
    }));

    await expect(store.actions.stage("/Name", "rejected")).rejects.toThrow("stage rejected");
    expect(registry.get(store.atoms.failure)?.message).toBe("stage rejected");
  });

  it("refuses save while open is running", async () => {
    let release!: (value: RouteStateWriteResult) => void;
    const { store } = make((fixture) => ({
      ...fixture,
      command: (name, input) =>
        name === "open"
          ? new Promise<RouteStateWriteResult>((resolve) => { release = resolve; })
          : fixture.command!(name, input),
    }));
    store.actions.setPicker({
      workspaceKey: "default",
      moduleKey: "CmdScheduleManager",
      rootKey: "schedules",
      filePath: "MechEquip/TEST.json",
    });

    const open = store.actions.open();
    await Promise.resolve();
    await expect(store.actions.save()).rejects.toThrow("another verb is running");
    release({ ok: true });
    await open;
  });

  it("keeps page picker state when a new version token arrives", async () => {
    const { registry, store } = make();
    const picker = {
      workspaceKey: "default",
      moduleKey: "CmdScheduleManager",
      rootKey: "schedules",
      filePath: "MechEquip/TEST.json",
    };
    store.actions.setPicker(picker);
    const before = registry.get(store.atoms.snapshot)?.versionToken;

    await store.actions.refresh();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(registry.get(store.atoms.snapshot)?.versionToken).not.toBe(before);
    expect(registry.get(store.atoms.picker)).toEqual(picker);
  });

  it("does not change the open document identity when the picker changes", () => {
    const { registry, store } = make();
    const before = registry.get(store.atoms.snapshot)?.documentId;

    store.actions.setPicker({
      workspaceKey: "default",
      moduleKey: "FamilyFoundry",
      rootKey: "models",
      filePath: "other.json",
    });

    expect(registry.get(store.atoms.snapshot)?.documentId).toEqual(before);
  });
});
