import { expect, it } from "vite-plus/test";
import { FIRM_COLOURS } from "#/ducts/colours";
import { toOklch } from "./oklch";
import { routeColour } from "./surfaces";
import { kindHue, kindL } from "./kinds";

it("the kinds table drives the hue, and an unlisted or absent kind draws as unknown grey", () => {
  expect(kindHue(FIRM_COLOURS, "supply")?.getHexString()).toBe("0569a5");
  expect(kindHue(FIRM_COLOURS, "return")?.getHexString()).toBe("02bba4");
  expect(kindHue(FIRM_COLOURS, "chilled-water")?.getHexString()).toBe("808080");
  expect(kindHue(FIRM_COLOURS, undefined)?.getHexString()).toBe("808080");
  expect(kindHue({}, "supply")).toBeUndefined();
});

it("a kind's base l replaces rung 0 and is clamped inside the theme's rung band", () => {
  const kinds = {
    pipe: { hue: "#0569a5", l: 0.52 },
    loud: { hue: "#0569a5", l: 0.99 },
    supply: "#0569a5",
  };
  const L = (kind: keyof typeof kinds, variant?: number) =>
    toOklch(
      routeColour(kindHue(kinds, kind)!, { tier: "subject", variant }, false, kindL(kinds, kind)),
    ).L;
  expect(kindL(kinds, "supply")).toBeUndefined();
  expect(L("pipe", 0)).toBeCloseTo(0.52, 2);
  expect(L("pipe", 1)).toBeCloseTo(0.64, 2);
  expect(L("loud", 0)).toBeCloseTo(0.7, 2);
  expect(L("supply", 0)).toBeCloseTo(0.46, 2);
});
