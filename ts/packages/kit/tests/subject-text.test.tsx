// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { proseIds, subjectDocument } from "../src/components/lang/subject-text";

// Every integer exists: preserving prose must not depend on a lucky missing Revit id.
const nameOf = (id: number) => `Element ${id}`;

test.each([
  "30×30 end cap, 20 ft, 250 cfm, FA 27, DH-20, FC-23, option 1.",
  "9999 and 1234:0",
  "14,607,308 and 12345,67890 and 12345678,90123456",
  "12345.6 and 0.12345678 and 12345:67890.5",
  "12345:0,67890 and 12345,67890:12345",
  "g14607308 and 14607308g and _14607308",
])("numeric prose stays literal: %s", (text) => {
  expect(proseIds(text)).toEqual([]);
  expect(subjectDocument([text], nameOf)).toEqual({ parts: [text], references: [] });
});

test("five-digit ids, comma separators and connector zero retain reading order", () => {
  const text = "12345; 14607308, 14107111; 14607308:0, then 14107111:2 and 14607308,";
  expect(proseIds(text)).toEqual([12345, 14607308, 14107111, 14607308, 14107111, 14607308]);
  const document = subjectDocument([text], nameOf);
  expect(document.references.map(({ id, number }) => [id, number])).toEqual([
    [12345, 1],
    [14607308, 2],
    [14107111, 3],
  ]);
  expect(
    document.parts.filter((part) => typeof part !== "string").map((part) => part.connector),
  ).toEqual([undefined, undefined, undefined, 0, 2, undefined]);
});

test("structured references and supplied row ids still support short real ids", () => {
  const document = subjectDocument(["30×30 ", { id: 30, connector: 0 }], nameOf, [20, 30]);
  expect(document.parts[0]).toBe("30×30 ");
  expect(document.parts[1]).toMatchObject({ id: 30, connector: 0, number: 1 });
  expect(document.references.map(({ id, number }) => [id, number])).toEqual([
    [30, 1],
    [20, 2],
  ]);
});
