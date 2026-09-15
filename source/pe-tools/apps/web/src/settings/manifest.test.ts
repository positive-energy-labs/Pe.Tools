/**
 * The settings manifest is the route's whole contract now: its Work spec, its file Readings, its
 * actions and their refusal sentences. What `store.test.ts` used to prove about the store's
 * picker/debounce machinery is gone with that machinery; what survives is proved here against the
 * SEEDS the demo lane mounts, so the seed map and the action list cannot drift apart.
 */
import { describe, expect, it } from "vite-plus/test";
import type { SettingsRouteDocument } from "@pe/agent-contracts";

import { settingsManifest } from "#/settings/manifest";
import { SETTINGS_SEEDS, SETTINGS_SEED_RAW, type SettingsAction } from "#/settings/seeds";

const manifest = settingsManifest({ scope: { route: "settings", target: null, work: "test" } });
const actions = manifest.actions!;
const names = Object.keys(actions) as SettingsAction[];

/** A `ready()` context: the parts of `Ctx` a refusal sentence is allowed to read. */
const ctx = (doc: SettingsRouteDocument | null, page: Record<string, unknown> = {}) =>
  ({ work: { doc, revision: 0 }, page, readings: {} }) as never;

describe("the settings manifest", () => {
  it("declares its Work, its two file Readings, and one seed per action", () => {
    expect(manifest.key).toBe("settings");
    expect(manifest.work?.route).toBe("settings");
    const readings = Object.entries(manifest.readings ?? {}).map(([key, request]) => {
      expect(typeof request).not.toBe("function");
      if (typeof request === "function") throw Error(`${key} must be a static Reading`);
      return [key, request.kind];
    });
    expect(readings).toEqual([
      ["document", "file"],
      ["schema", "file"],
    ]);
    // Totality: `?demo=<action>` must have a moment to mount for every action the route declares.
    expect(names.sort()).toEqual(Object.keys(SETTINGS_SEEDS).sort());
    for (const name of names) expect(SETTINGS_SEEDS[name].title.length).toBeGreaterThan(0);
  });

  it("refuses every document action until a basis is adopted", () => {
    const empty: SettingsRouteDocument = { basis: null, fields: {} };
    for (const name of ["refresh", "validate", "adopt", "save", "stage"] as const)
      expect(actions[name].ready(ctx(empty), undefined as never)).toBe(
        "open a settings file first",
      );
    // `open` is the one action that runs with no Work: it is what creates the basis.
    expect(actions.open.ready(ctx(empty), undefined as never)).toBe("pick a settings file first");
    expect(
      actions.open.ready(ctx(empty, { filePath: "MechEquip/TEST.json" }), undefined as never),
    ).toBeNull();
  });

  it("lets each seed run its own action, and names the human ones", () => {
    expect(SETTINGS_SEEDS.save.work.basis?.rawContent).toBe(SETTINGS_SEED_RAW);
    // A seed IS the moment its action is for, so each action is asked in its OWN seed: `stage`
    // needs the field its page names, which only the stage seed carries.
    for (const name of names) {
      const seed = SETTINGS_SEEDS[name];
      expect(actions[name].ready(ctx(seed.work, seed.page), undefined as never), name).toBeNull();
    }
    // Mutation is explicit: save and adopt are never an agent's to take.
    expect(actions.save.actor).toBe("human");
    expect(actions.adopt.actor).toBe("human");
    expect(actions.stage.actor).toBe("human");
    expect(actions.refresh.actor).toBe("any");
  });

  it("refuses to save a basis that was never version-stamped", () => {
    const unstamped: SettingsRouteDocument = {
      basis: { ...SETTINGS_SEEDS.save.work.basis!, versionToken: "" },
      fields: {},
    };
    expect(actions.save.ready(ctx(unstamped), undefined as never)).toBe(
      "review an adopted file before saving",
    );
  });
});
