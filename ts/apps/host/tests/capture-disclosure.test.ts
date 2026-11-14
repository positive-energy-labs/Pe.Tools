import { expect, test } from "vite-plus/test";
import { nativeResponseSchema } from "@pe/host-contracts/native-schemas";
import { nativeOutputAssets, nativeOutputSchema } from "@pe/agent-contracts/native-output-read";
import { callPolicies } from "../../../packages/agent-contracts/src/call-policy.ts";
import { nativeRead } from "../src/reads/door.ts";

const keys = ["revit.context.view-image", "revit.context.view-image.focus"] as const;
// Deliberately synthetic: this proves the wire boundary, never model visibility.
const image = {
  view: { kind: "View", documentKey: "doc", elementId: 1, uniqueId: "view", label: "Plan" },
  filePath: "C:/test.png", byteSize: 1, width: 100, height: 100,
  lens: { basis: "UserView", viewId: 1 },
  hidden: [{ what: "Links", count: 2, why: "NotEvaluated" }],
  marks: [],
  refused: false, notDrawn: [],
};
const capture = {
  id: "test", sha: "a".repeat(64), at: "2026-11-13T00:00:00.000Z", origin: "human",
  document: {}, view: {}, focus: null, registration: null, marks: [], byteSize: 1,
  url: `/captures/${"a".repeat(64)}.png`,
};

test("the read door admits the unfocused capture and refuses its SessionWrite twin", () => {
  expect(() => nativeRead(keys[0])).not.toThrow();
  expect(() => nativeRead(keys[1])).toThrow(/not a catalog Read/);
});

test.each(keys)("%s keeps category disclosure at raw and projected output boundaries", key => {
  expect(callPolicies[key]?.capture).toBe(true);
  expect(nativeResponseSchema(key).parse(image)).toMatchObject({ lens: image.lens, hidden: image.hidden });
  const { filePath: _, ...body } = image;
  const projected = { ...body, capture, imageUrl: capture.url };
  expect(nativeOutputSchema(key).parse(projected)).toMatchObject({ lens: image.lens, hidden: image.hidden });
  for (const field of ["lens", "hidden", "marks"] as const) {
    const missing = { ...image }; delete (missing as Partial<typeof image>)[field];
    expect(nativeResponseSchema(key).safeParse(missing).success, field).toBe(false);
    const dropped = { ...projected }; delete (dropped as Partial<typeof projected>)[field];
    expect(nativeOutputSchema(key).safeParse(dropped).success, field).toBe(false);
  }
});

test.each(keys)("%s preserves a typed refusal without an image asset", key => {
  const notDrawn = [{ elementId: 7, reasons: ["PhaseHidden", "OutsideSectionBox"] }];
  const raw = { ...image, refused: true, notDrawn, filePath: null, byteSize: 0, width: 0, height: 0 };
  expect(nativeResponseSchema(key).parse(raw)).toMatchObject({ refused: true, notDrawn });
  const { filePath: _, ...body } = raw;
  const output = nativeOutputSchema(key).parse({ ...body, capture: null, imageUrl: null });
  expect(output).toMatchObject({ refused: true, notDrawn, capture: null, imageUrl: null });
  expect(nativeOutputAssets(key, output)).toEqual([]);
});
