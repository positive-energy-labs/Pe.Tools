import { expect, test } from "vite-plus/test";
import { ductsDocumentSchema, stagedDucts } from "@pe/agent-contracts";
import { coloursOf, FIRM_COLOURS } from "./colours";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { paintOfDucts } from "./selection";
import { kindHue } from "#/scene/kinds";
import type { SceneInstance } from "#/scene/types";

test("the settings palette supplies the kinds table and never enters Revit apply", () => {
  const palette = { ...FIRM_COLOURS, supply: "#123456" };
  const settings = { supplyColour: "#123456" };
  expect(coloursOf(settings)).toEqual(palette);
  expect(coloursOf(null)).toEqual(FIRM_COLOURS);
  expect(stagedDucts(ductsDocumentSchema.parse({}))).not.toHaveProperty("systemColours");
  const { snapshot } = NAVIGATION_FIXTURE;
  const id = snapshot.segments[0]!.id;
  const instance = { revitId: id } as SceneInstance;
  // The paint names the kind; the staged palette is the Scene3D kinds table that gives it a hue.
  expect(paintOfDucts(snapshot, new Set([id]), new Set())(instance)).toEqual({
    tier: "subject",
    kind: "supply",
  });
  expect(kindHue(coloursOf(settings), "supply")?.getHexString()).toBe("123456");
});
