import { expect, test } from "vite-plus/test";
import {
  lensScrollIntent,
  nextTailFollowState,
  scrollTopForIntent,
  tailFollowState,
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

test("tail follow detaches when the user scrolls away", () => {
  expect(tailFollowState({ scrollTop: 1300, scrollHeight: 2000, clientHeight: 500 })).toBe(
    "following",
  );
  expect(tailFollowState({ scrollTop: 1000, scrollHeight: 2000, clientHeight: 500 })).toBe(
    "detached",
  );
});

test("tail follow survives content growth until the user scrolls up", () => {
  expect(
    nextTailFollowState(
      "following",
      { scrollTop: 1500, scrollHeight: 2400, clientHeight: 500 },
      1500,
    ),
  ).toBe("following");
  expect(
    nextTailFollowState(
      "following",
      { scrollTop: 1200, scrollHeight: 2400, clientHeight: 500 },
      1500,
    ),
  ).toBe("detached");
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
