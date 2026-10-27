import { expect, test } from "vite-plus/test";
import { ductsDocumentSchema, stagedDucts } from "@pe/agent-contracts";
import { coloursOf, FIRM_COLOURS } from "./colours";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { paintOfDucts } from "./selection";
import type { SceneInstance } from "#/scene/types";

test("the edit palette persists with Work, supplies instance ink and never enters Revit apply", () => {
  const palette = { ...FIRM_COLOURS, supply: "#123456" };
  const saved = JSON.stringify(
    ductsDocumentSchema.parse({ systemColours: { edit: { value: palette } } }),
  );
  const doc = ductsDocumentSchema.parse(JSON.parse(saved));
  expect(coloursOf(doc)).toEqual(palette);
  expect(coloursOf(null)).toEqual(FIRM_COLOURS);
  expect(stagedDucts(doc)).not.toHaveProperty("systemColours");
  const { snapshot } = NAVIGATION_FIXTURE;
  const id = snapshot.segments[0]!.id;
  const instance = { revitId: id } as SceneInstance;
  expect(paintOfDucts(snapshot, new Set([id]), new Set(), true, coloursOf(doc))(instance)).toEqual({
    tier: "subject",
    key: "supply",
    ink: "#123456",
  });
  expect(paintOfDucts(snapshot, new Set([id]), new Set(), false, coloursOf(doc))(instance)).toEqual(
    { tier: "subject" },
  );
});
