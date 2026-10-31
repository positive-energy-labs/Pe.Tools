import { expect, test } from "vite-plus/test";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { ruleByKey } from "@pe/ducts-domain/loss-rules";
import { barRows, ruleConditions, selectedBarRow } from "./bar-model";
import type { Split } from "../../loss-split";

test("the open rule editor follows its fittings when repricing changes their group key", () => {
  const selected = { key: "unpriced radius", ids: [7, 8] };
  const regrouped = { key: "mitered CR3-6", ids: [7, 8, 9] };
  expect(selectedBarRow([regrouped], selected)).toBe(regrouped);
  expect(selectedBarRow([regrouped, selected], selected)).toBe(selected);
  expect(selectedBarRow([{ key: "another family", ids: [10] }], selected)).toBeUndefined();
});

test("bar columns follow this run's actual rules, lookup inputs, unique count and unknown loss", () => {
  const node = {
    id: 1,
    family: "Elbow family",
    facts: [{ key: "rOverD", value: 0.75 }],
  } as DuctSnapshot["nodes"][number];
  const part = { dp: 0, ids: [], unpriced: 0 };
  const split: Split = {
    unit: part,
    duct: part,
    terminal: part,
    groups: [
      {
        key: "elbow",
        part: "duct",
        element: "fitting",
        label: "Elbow",
        dp: 0.2,
        ids: [1],
        unpriced: 0,
      },
      {
        key: "unknown",
        part: "terminal",
        element: "terminal",
        label: "Grille",
        dp: 0,
        ids: [2],
        unpriced: 1,
      },
    ],
    rows: [
      {
        id: 1,
        kind: "fitting",
        rule: "elbow-075d",
        table: "CD3-12",
        dp: 0.1,
        desc: "",
        inputs: { res: "Co", x: 0.75, xLabel: "r/D" },
      },
      {
        id: 1,
        kind: "fitting",
        rule: "elbow-1d-le10",
        table: "CD3-9",
        dp: 0.1,
        desc: "",
        inputs: { res: "Co", x: 8, xLabel: "D, in" },
      },
      { id: 2, kind: "terminal", dp: null, desc: "No drop" },
    ],
  };
  const [elbow, unknown] = barRows(split, 0.4, new Map([[1, node]]));
  expect(elbow).toMatchObject({
    count: 1,
    dp: 0.2,
    share: 50,
    at: [0.25],
    families: ["Elbow family"],
    tables: ["CD3-12", "CD3-9"],
  });
  expect(elbow!.rules.map((rule) => rule.key)).toEqual(["elbow-075d", "elbow-1d-le10"]);
  expect(elbow!.conditions).toEqual(["0.75 D", "1 D · D <= 10 in", "r/D = 0.75", "D, in = 8"]);
  expect(elbow!.candidates.map((rule) => rule.key)).toEqual([
    "elbow-1d-le10",
    "elbow-1d-gt10",
    "elbow-075d",
    "elbow-15d-90-le10",
    "elbow-15d-45-le10",
    "elbow-round-radius",
  ]);
  expect(ruleConditions(ruleByKey("elbow-075d")!, elbow!).inactive).toBe(false);
  expect(ruleConditions(ruleByKey("elbow-1d-le10")!, elbow!).inactive).toBe(true);
  expect(unknown).toMatchObject({ unpriced: 1, at: [], count: 1, candidates: [], conditions: [] });
});
