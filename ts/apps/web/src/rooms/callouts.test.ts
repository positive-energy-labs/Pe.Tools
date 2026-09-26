/** Callout placement, deterministic: three overlapping small polygons each get a free pin on a leader. */
import { expect, test } from "vite-plus/test";

import { placeCallouts, type CalloutItem } from "./callouts";

const items: CalloutItem[] = [
  { label: "R1", anchor: [200, 150], text: "13 sf", fits: false },
  { label: "R2", anchor: [204, 152], text: "11 sf", fits: false },
  { label: "R3", anchor: [198, 156], text: "5 sf · too-small-under-6sf", fits: false },
];

test("three small overlapping regions: every pin leaves on a leader, no two boxes overlap", () => {
  const placed = placeCallouts(items, { width: 400, height: 300 }, 10);
  expect(placed.map((c) => c.label)).toEqual(["R1", "R2", "R3"]);
  expect(placed.every((c) => c.leader)).toBe(true);
  for (const [i, a] of placed.entries())
    for (const b of placed.slice(i + 1))
      expect(
        a.box[2] < b.box[0] || a.box[0] > b.box[2] || a.box[3] < b.box[1] || a.box[1] > b.box[3],
      ).toBe(true);
  expect(placed.map((c) => c.pin)).toMatchInlineSnapshot(`
    [
      [
        224,
        126,
      ],
      [
        228,
        176,
      ],
      [
        134,
        92,
      ],
    ]
  `);
  expect(placeCallouts(items, { width: 400, height: 300 }, 10)).toEqual(placed);
});

test("a region that fits keeps its pin on the anchor; an off-screen anchor draws no pin", () => {
  const placed = placeCallouts(
    [
      { label: "Office", anchor: [100, 100], text: "240 sf", fits: true },
      { label: "R9", anchor: [-5, 100], text: "20 sf", fits: true },
    ],
    { width: 400, height: 300 },
    10,
  );
  expect(placed).toHaveLength(1);
  expect(placed[0]!.pin).toEqual([100, 100]);
  expect(placed[0]!.leader).toBe(false);
});
