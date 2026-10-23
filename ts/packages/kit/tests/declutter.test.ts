import { expect, test } from "vite-plus/test";
import { declutter } from "../src/components/lang/declutter";

test("placement uses bounded free alternatives and drops impossible labels", () => {
  const box = { x: 0, y: 0, width: 20, height: 12 };
  expect(
    declutter(
      [
        { ...box, value: "first" },
        { ...box, value: "second", candidates: [{ ...box, y: 12 }] },
        { ...box, value: "dropped" },
      ],
      { ...box, height: 24 },
    ),
  ).toEqual([
    expect.objectContaining({ value: "first", y: 0 }),
    expect.objectContaining({ value: "second", y: 12 }),
    null,
  ]);
  expect(declutter([{ ...box, x: -1, value: "outside" }], box)).toEqual([null]);
});
