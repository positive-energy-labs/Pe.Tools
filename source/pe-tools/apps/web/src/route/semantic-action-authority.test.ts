import { expect, test } from "vite-plus/test";
import { semanticActions } from "@pe/agent-contracts";

import { manifest as family } from "#/family/manifest";
import { manifest as families } from "#/families/manifest";
import { manifest as parameterLinks } from "#/parameter-links/manifest";
import { schedulesManifest } from "#/route/schedules/manifest";
import { settingsManifest } from "#/settings/manifest";
import { manifest as takeoffs } from "#/takeoff/manifest";

test("browser semantic mutations project shared prose, actor, and target need", () => {
  const settings = settingsManifest({ scope: { route: "pods", target: null, work: "test" }, member: { pod: "p", path: "settings/a.json" } });
  const pairs = [
    [settings.actions!.save, "settings.write"],
    [family.actions!.build, "family.build"],
    [family.actions!.apply, "family.apply"],
    [families.actions!.apply, "families.apply"],
    [parameterLinks.actions!.apply, "parameter-links.apply"],
    [schedulesManifest().actions!.push, "schedule.grid.push"],
    [takeoffs.actions!["commit-sync"], "takeoffs.sync"],
  ] as const;
  const needs = {
    nothing: "host",
    session: "session",
    document: "document",
    "project-document": "project",
    "family-document": "family",
  } as const;

  for (const [browser, key] of pairs) {
    const semantic = semanticActions[key];
    expect(browser).toMatchObject({
      says: semantic.says,
      actor: semantic.actor,
      needs: needs[semantic.needs],
    });
  }
});

test("Takeoffs sync remains agent-capable while its browser review and admission guards stay local", () => {
  expect(semanticActions["takeoffs.sync"].actor).toBe("any");
  expect(takeoffs.actions!["commit-sync"]).toMatchObject({
    actor: "any",
    requires: { work: true, readings: ["snapshot", "rhvacVersion"] },
    dirties: ["snapshot", "rhvacVersion", "receipts"],
  });
  expect(takeoffs.actions!.sync.actor).toBe("human");
});
