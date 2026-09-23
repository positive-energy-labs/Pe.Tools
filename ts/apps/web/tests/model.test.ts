import { expect, test } from "vite-plus/test";
import {
  lensScrollIntent,
  scrollTopForIntent,
  turnAtFocalPoint,
  type ScrollMetrics,
} from "../src/workbench/model";

const metrics: ScrollMetrics = { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 };

test("missing focus opens at the tail", () => {
  expect(scrollTopForIntent(lensScrollIntent(), [], metrics)).toBe(1500);
});

test("known focus lands on the focal line", () => {
  expect(
    scrollTopForIntent(
      lensScrollIntent(2),
      [{ key: "m2", turn: 2, top: 800, height: 100 }],
      metrics,
    ),
  ).toBe(500);
});

test("unknown focus falls back to tail", () => {
  expect(
    scrollTopForIntent(
      lensScrollIntent(9),
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
