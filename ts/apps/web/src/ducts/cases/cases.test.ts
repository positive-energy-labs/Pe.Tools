import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DUCT_CASES } from "./data";
import { CaseDrawing, CaseLegend, SCENE_KEYS } from "./draw";

describe("duct tutorial cases", () => {
  it("keeps all 58 unique cases in order, with 22 absent and every scene available", () => {
    expect(DUCT_CASES).toHaveLength(58);
    expect(new Set(DUCT_CASES.map(({ number }) => number)).size).toBe(58);
    expect(DUCT_CASES.map(({ number }) => number)).toEqual(
      Array.from({ length: 59 }, (_, index) => index + 1).filter((number) => number !== 22),
    );
    for (const { scene, sceneLabel } of DUCT_CASES) {
      if (scene !== null) {
        expect(SCENE_KEYS).toContain(scene);
        expect(sceneLabel?.trim()).toBeTruthy();
      }
    }
  });

  it.each(SCENE_KEYS)("renders scene %s as a labelled, self-contained SVG", (scene) => {
    const example = DUCT_CASES.find((item) => item.scene === scene);
    const label = example?.sceneLabel ?? scene;
    const markup = renderToStaticMarkup(createElement(CaseDrawing, { scene, label }));
    expect(markup).toContain("<svg");
    expect(markup).toContain(`aria-label="${label}"`);
    expect(markup).toContain('viewBox="0 0 260 170"');
    expect(markup).not.toContain("font-family");
    for (const [, markerId] of markup.matchAll(/marker-end="url\(#([^)]*)\)"/g)) {
      expect(markup).toContain(`id="${markerId}"`);
    }
  });

  it("keeps client names and scratchpad URLs out of every case field", () => {
    expect(JSON.stringify(DUCT_CASES)).not.toMatch(/chadds/i);
    expect(JSON.stringify(DUCT_CASES)).not.toContain("http://127.0.0.1:5175");
  });

  it("gives every route example a non-empty system or selection", () => {
    for (const { examples } of DUCT_CASES) {
      for (const { system, selected } of examples) {
        expect(Boolean(system?.trim() || selected?.trim())).toBe(true);
      }
    }
  });

  it("renders all seven legend marks with their meanings", () => {
    const markup = renderToStaticMarkup(createElement(CaseLegend));
    for (const meaning of [
      "real Revit connection",
      "join Pe infers",
      "open end",
      "air flow",
      "fan",
      "passive unit",
      "refused join",
    ]) {
      expect(markup).toContain(meaning);
    }
    expect(markup.match(/<svg/g)).toHaveLength(7);
  });
});
