import { opsManifest } from "#/ops/manifest";
import { expect, test } from "vite-plus/test";
import { semanticActions, opsAction } from "@pe/agent-contracts";

import { manifest as family } from "#/routes/family";
import { manifest as families } from "#/families/manifest";
import { manifest as parameterLinks } from "#/parameter-links/manifest";
import { schedulesManifest } from "#/route/schedules/manifest";
import { memberWorkManifest } from "#/route/spec-editor";
import { manifest as takeoffs } from "#/takeoff/manifest";

test("browser semantic mutations project shared prose, actor, and target need", () => {
  const settings = memberWorkManifest();
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

test("Ops projects shared prose, actor and the selected operation's target need", () => {
  for (const op of [
    { key: "pod.list", needs: "nothing" as const, intent: "Read" as const },
    { key: "scripting.execute", needs: "nothing" as const, intent: "Mutate" as const },
    { key: "family.apply", needs: "family-document" as const, intent: "Mutate" as const },
  ])
    expect(opsManifest({ selected: op }).actions!.run).toMatchObject(
      opsAction(op.needs, op.key === "pod.list"),
    );
});
