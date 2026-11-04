// U4 wires the real fans Work for callers without one.
import { neutralFansWork } from "@pe/agent-contracts";
import { designOf } from "@pe/ducts-domain/test-design";
import { expect, test } from "vite-plus/test";
import { stagedDucts } from "@pe/agent-contracts";
import { coloursOf, FIRM_COLOURS } from "./colours";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { paintOfDucts } from "./selection";
import { kindHue } from "#/scene/kinds";
import type { SceneInstance } from "#/scene/types";

test("the edit palette persists with Work, supplies the kinds table and never enters Revit apply", () => {
  const palette = { ...FIRM_COLOURS, supply: "#123456" };
  const saved = JSON.stringify(
    designOf({ systemColours: { edit: { value: palette } } }),
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
