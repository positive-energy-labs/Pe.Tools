import { expect, it } from "vite-plus/test";
import { observedElements } from "./observation";

it("indexes only captured references and never reuses identity across captures", () => {
  const first = { elementId: 7, uniqueId: "captured-first" };
  const references = [first, { elementId: 7, uniqueId: "duplicate" }];
  const observation = { scope: null, references };
  expect(observedElements(observation, [7, 8, 7])).toEqual({
    scope: null,
    ids: [],
    refs: [first, { elementId: null }, first],
  });
  expect(observedElements(observation, [7]).refs?.[0]).toBe(first);
  const reopened = { elementId: 7, uniqueId: "different-document-lifetime" };
  expect(observedElements({ scope: null, references: [reopened] }, [7]).refs).toEqual([reopened]);
  expect(observedElements({ scope: null, references: [] }, [7]).refs).toEqual([
    { elementId: null },
  ]);
  expect(observedElements({ scope: null }, [7])).toEqual({ scope: null, ids: [7] });
});
