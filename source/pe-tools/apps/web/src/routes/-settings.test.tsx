/**
 * The route module's own contract: one `manifest` export (the guard greps for exactly one), a
 * search schema with no dead lanes in it, and a demo lane that is the manifest's seeds rather
 * than a second store. The rendered surface is proved by `settings/manifest.test.ts` (actions and
 * refusals) and `settings-panes/schema-form.test.tsx` (the seed document through the renderer).
 */
import { describe, expect, it } from "vite-plus/test";

import { manifest, settingsSearch } from "./settings";

describe("the settings route module", () => {
  it("keeps thread in the search and carries no source lane", () => {
    expect(settingsSearch({ thread: " review " })).toMatchObject({ thread: "review" });
    // The old `?source=` branch is gone: an unknown search key is simply not part of the address.
    expect(settingsSearch({ source: "anything" })).not.toHaveProperty("source");
    expect(
      settingsSearch({
        mode: "file",
        module: "CmdScheduleManager",
        root: "schedules",
        file: "a.json",
      }),
    ).toMatchObject({
      mode: "file",
      module: "CmdScheduleManager",
      root: "schedules",
      file: "a.json",
    });
  });

  it("exports one manifest whose seeds cover its actions", () => {
    expect(manifest.key).toBe("settings");
    expect(Object.keys(manifest.seeds ?? {}).sort()).toEqual(
      Object.keys(manifest.actions ?? {}).sort(),
    );
  });
});
