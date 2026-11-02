import { expect, test } from "vite-plus/test";
import { placeCallouts, PIN_R } from "./callouts";

test("crowded callouts keep a measured box even when no placement fits", () => {
  const callouts = placeCallouts(
    [
      { label: "1", text: "100 sf", anchor: [1, 1], fits: false },
      { label: "2", text: "", anchor: [1, 1], fits: false },
    ],
    { width: 2, height: 2 },
    PIN_R,
  );
  expect(callouts).toHaveLength(2);
  for (const callout of callouts) {
    expect(callout.box[2] - callout.pin[0] - 4).toBeGreaterThanOrEqual(0);
    expect(callout.box[3] - callout.box[1]).toBeGreaterThan(0);
  }
});
