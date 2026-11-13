import { expect, test } from "vite-plus/test";
import { nativeResponseSchema } from "@pe/host-contracts/native-schemas";
import { nativeOutputSchema } from "@pe/agent-contracts/native-output-read";
import { callPolicies } from "../../../packages/agent-contracts/src/call-policy.ts";
import { nativeRead } from "../src/reads/door.ts";

const keys = ["revit.context.view-image", "revit.context.view-image.focus"] as const;
// Deliberately synthetic: this proves the wire boundary, never model visibility.
const image = {
  view: { kind: "View", documentKey: "doc", elementId: 1, uniqueId: "view", label: "Plan" },
  filePath: "C:/test.png", byteSize: 1, width: 100, height: 100,
  lens: { basis: "UserView", viewId: 1 },
  hidden: [{ what: "Links", count: 2, why: "NotEvaluated" }],
};
const capture = {
  id: "test", sha: "a".repeat(64), at: "2026-11-13T00:00:00.000Z", origin: "human",
  document: {}, view: {}, focus: null, registration: null, byteSize: 1,
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
  for (const field of ["lens", "hidden"] as const) {
    const missing = { ...image }; delete (missing as Partial<typeof image>)[field];
    expect(nativeResponseSchema(key).safeParse(missing).success, field).toBe(false);
    const dropped = { ...projected }; delete (dropped as Partial<typeof projected>)[field];
    expect(nativeOutputSchema(key).safeParse(dropped).success, field).toBe(false);
  }
});
