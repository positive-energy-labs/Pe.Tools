import { neutralFansWork } from "@pe/agent-contracts";
import { designOf } from "@pe/ducts-domain/test-design";
import { expect, test } from "vite-plus/test";
import { stagedDucts } from "@pe/agent-contracts";
import { coloursOf, FIRM_COLOURS } from "./colours.ts";
import { NAVIGATION_FIXTURE } from "./navigation.fixture.ts";
import { paintOfDucts } from "./selection.ts";
import { kindHue } from "../../../../apps/web/src/scene/kinds.ts";
import type { SceneInstance } from "../../../../apps/web/src/scene/types.ts";

test("the edit palette persists with Work, supplies the kinds table and never enters Revit apply", () => {
  const palette = { ...FIRM_COLOURS, supply: "#123456" };
  const saved = JSON.stringify(
    designOf({ systemColours: { edit: { value: palette, by: "human" } } }),
  );
  const doc = designOf(JSON.parse(saved));
  expect(coloursOf(doc)).toEqual(palette);
  expect(coloursOf(null)).toEqual(FIRM_COLOURS);
  expect(stagedDucts(doc, doc ?? neutralFansWork)).not.toHaveProperty("systemColours");
  const { snapshot } = NAVIGATION_FIXTURE;
  const id = snapshot.segments[0]!.id;
  const instance = { revitId: id } as SceneInstance;
  // The paint names the kind; the staged palette is the Scene3D kinds table that gives it a hue.
  expect(paintOfDucts(snapshot, new Set([id]), new Set())(instance)).toEqual({
    tier: "subject",
    kind: "supply",
  });
  expect(kindHue(coloursOf(doc), "supply")?.getHexString()).toBe("123456");
});
