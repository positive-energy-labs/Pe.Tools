import { expect, test } from "vite-plus/test";
import * as attention from "@pe/kit/lang/attention";

/*
 * Slice 8 sends this to the kit owner (routes MAP deletion criteria: a kit change is a red
 * `kernel gap:` test, never a local patch). The kit's `elementKey`/`elementUniqueId` are a second
 * spelling of the SubjectRef codec (`subjectCode`/`decode` in agent-contracts subject-ref): every
 * door should decode the one codec. Kit uses them in attention, chip, go-to, list-view, row and
 * subject-text; web in element-index, the picture, rooms, revit element-target and reading-references.
 * Green when the kit exports neither and its callers use the codec.
 */
test.fails("kernel gap: kit-element-key (8) the kit spells element keys outside the SubjectRef codec", () => {
  expect(Object.keys(attention)).not.toEqual(expect.arrayContaining(["elementKey"]));
  expect(Object.keys(attention)).not.toEqual(expect.arrayContaining(["elementUniqueId"]));
});
