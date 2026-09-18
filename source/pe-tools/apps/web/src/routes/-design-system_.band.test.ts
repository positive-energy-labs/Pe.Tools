import { expect, test } from "vite-plus/test";

import {
  bandFixtureReducer,
  INITIAL_BAND_FIXTURE,
  PLAN_REFUSAL,
  planRefusal,
} from "./design-system_.band";

test("unstage restores a standing proposal and otherwise the baseline", () => {
  const proposed = bandFixtureReducer(INITIAL_BAND_FIXTURE, {
    type: "unstage",
    key: "neckHeight",
  }).items.find((item) => item.key === "neckHeight")!;
  const baseline = bandFixtureReducer(INITIAL_BAND_FIXTURE, {
    type: "unstage",
    key: "throw",
  }).items.find((item) => item.key === "throw")!;

  expect(proposed.cell).toMatchObject({ proposal: { value: "10in" }, staged: null });
  expect(baseline.cell).toEqual({ proposal: null, staged: null });
});

test("K5 refuses plan only while conflict is on", () => {
  expect(planRefusal(INITIAL_BAND_FIXTURE)).toBeNull();
  const conflict = bandFixtureReducer(INITIAL_BAND_FIXTURE, {
    type: "set-conflict",
    value: true,
  });
  expect(planRefusal(conflict)).toBe(PLAN_REFUSAL);
});

test("ask expiry leaves proposal Work intact and adds a transcript record", () => {
  const expires = bandFixtureReducer(INITIAL_BAND_FIXTURE, {
    type: "set-ask-survives",
    value: false,
  });
  const after = bandFixtureReducer(expires, { type: "ask-event", event: "reload" });

  expect(after.askVisible).toBe(false);
  expect(after.records).toEqual(["family.capture expired when reload"]);
  expect(after.items).toBe(INITIAL_BAND_FIXTURE.items);
});
