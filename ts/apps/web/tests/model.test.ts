import { expect, test } from "vite-plus/test";
import {
  intentAt,
  scrollTopForIntent,
  turnAtFocalPoint,
  type ScrollMetrics,
} from "../src/workbench/model";

const metrics: ScrollMetrics = { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 };

test("missing focus opens at the tail", () => {
  expect(scrollTopForIntent({ kind: "tail" }, [], metrics)).toBe(1500);
});

test("known focus lands on the focal line", () => {
  expect(
    scrollTopForIntent(
      { kind: "turn", turn: 2 },
      [{ key: "m2", turn: 2, top: 800, height: 100 }],
      metrics,
    ),
  ).toBe(500);
});

test("unknown focus falls back to tail", () => {
  expect(
    scrollTopForIntent(
      { kind: "turn", turn: 9 },
      [{ key: "m2", turn: 2, top: 800, height: 100 }],
      metrics,
    ),
  ).toBe(1500);
});

test("focal point reports the current turn", () => {
  expect(
    turnAtFocalPoint(
      [
        { key: "m1", turn: 1, top: 0, height: 500 },
        { key: "m2", turn: 2, top: 500, height: 500 },
      ],
      { scrollTop: 300, scrollHeight: 1500, clientHeight: 500 },
    ),
  ).toBe(2);
});

test("a view at the bottom reopens at the tail, not the focal turn", () => {
  const geometry = [
    { key: "m1", turn: 1, top: 0, height: 500 },
    { key: "m2", turn: 2, top: 500, height: 1000 },
  ];
  expect(intentAt(geometry, { scrollTop: 1000, scrollHeight: 1500, clientHeight: 500 })).toEqual({
    kind: "tail",
  });
  expect(intentAt(geometry, { scrollTop: 300, scrollHeight: 1500, clientHeight: 500 })).toEqual({
    kind: "turn",
    turn: 2,
  });
});
