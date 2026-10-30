import * as THREE from "three";
import { expect, test } from "vite-plus/test";
import type { DuctsHeal } from "@pe/host-contracts/generated";
import { healPlan } from "@pe/ducts-domain/heal";
import type { VerbScope } from "#/shell/verbs";
import { snapshot } from "./test-fixture";
import { presentHeal, presentFan, type HealReview } from "./reviews";
import { healReviewLayers } from "./finding-layers";

const scope = (): VerbScope => {
  const ducts = structuredClone(snapshot);
  const segment = ducts.segments[0]!;
  segment.connectors.push({
    ...segment.connectors[0]!,
    index: 9,
    point: [-10, 0, 0],
    facing: [-1, 0, 0],
    diameterIn: 8,
    connectedTo: null,
  });
  ducts.issues.push({
    id: "open-end:1:9",
    kind: "open-end",
    elementId: 1,
    connector: 9,
    note: "open end",
  });
  return {
    page: { layers: [] },
    snapshot: { target: { kind: "host" }, work: null, basis: null },
    subject: null,
    value: null,
    readings: {
      ducts: {
        status: "ready",
        value: ducts,
        version: 1,
        current: true,
        complete: true,
        basis: null,
      },
    },
  };
};

test.each([true, false])(
  "heal presentation draws admitted targets and excludes rolled-back ids (preview %s)",
  (previewOnly) => {
    const ctx = scope();
    const ducts = ctx.readings.ducts!.value as typeof snapshot;
    const group = healPlan(ducts, null).groups[0]!;
    const response: DuctsHeal.Res.Response = {
      previewOnly,
      counts: { planned: previewOnly ? 1 : 0, healed: previewOnly ? 0 : 1, refused: 0 },
      groups: [
        {
          group: group.group,
          outcome: previewOnly ? "planned" : "healed",
          systemsBefore: [],
          systemsAfter: [],
          items: group.items.map((item) => ({
            key: item.key,
            kind: item.kind,
            outcome: previewOnly ? "planned" : "healed",
            created: [7001],
            replaced: [],
            check: "connection checked",
          })),
        },
      ],
    };
    const presentation = presentHeal({ response }, ctx);
    expect(presentation.sentence).toContain(previewOnly ? "1 planned" : "1 healed");
    expect(presentation.rows[0]).toContain("cap");
    const review = presentation.page!.heal as HealReview;
    expect(review.targets[0]!.ids).toEqual(previewOnly ? [1] : [1, 7001]);
    expect(review.before.roots).toEqual([100]);
    expect(presentation.page!.layers).toEqual(["findings"]);
    const layers = healReviewLayers(ducts, null, review);
    expect(layers.some((layer) => layer.key.includes("heal:"))).toBe(true);
    expect(layers.flatMap((layer) => layer.targets ?? [])).toContainEqual({
      key: "heal:g1",
      elementId: 1,
    });
    const drawn = new THREE.Group();
    for (const layer of layers) layer.build(drawn);
    const ghosts: boolean[] = [];
    drawn.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (typeof object.userData.ghost === "boolean") ghosts.push(object.userData.ghost);
        object.geometry.dispose();
        if (!Array.isArray(object.material)) object.material.dispose();
      }
    });
    expect(ghosts).toEqual([previewOnly]);
  },
);

test("fan review uses the system, unit and native read-back words", () => {
  const review = presentFan(
    {
      response: {
        previewOnly: true,
        systemId: 900,
        unitId: 100,
        outcome: "planned",
        check: "base equipment checked",
      },
    },
    scope(),
  );
  expect(review.sentence).toBe("SA: base equipment checked");
  expect(review.rows).toEqual(["Make FC-1 the fan of SA: planned"]);
  expect(
    presentFan(
      { value: { systemId: 900, unitId: 100, outcome: "refused", reason: "already assigned" } },
      scope(),
    ).sentence,
  ).toBe("SA: refused: already assigned");
});
