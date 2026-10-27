import { expect, it } from "vite-plus/test";
import { FIRM_COLOURS } from "#/ducts/colours";
import { kindHue } from "./kinds";

it("the kinds table drives the hue, and an unlisted or absent kind draws as unknown grey", () => {
  expect(kindHue(FIRM_COLOURS, "supply")?.getHexString()).toBe("0569a5");
  expect(kindHue(FIRM_COLOURS, "return")?.getHexString()).toBe("02bba4");
  expect(kindHue(FIRM_COLOURS, "chilled-water")?.getHexString()).toBe("808080");
  expect(kindHue(FIRM_COLOURS, undefined)?.getHexString()).toBe("808080");
  expect(kindHue({}, "supply")).toBeUndefined();
});
