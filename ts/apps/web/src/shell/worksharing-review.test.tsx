// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { borrowWords, WorksharingNote } from "./mount-verbs";
import {worksharingOf} from "./review-contract";
import { leaks } from "./visible-text";

afterEach(cleanup);
// The Manual D re-drive #4 commit: MUAS 10 and Project Information borrowed, _PE_DuctLosses created.
const preview = {
  response: {
    writes: [],
    worksharing: {
      cloud: true,
      elements: [
        { id: 14577391, name: "MUAS 10", status: "borrows", owner: null },
        { id: 76675, name: "Project Information", status: "borrows", owner: null },
        { id: 14607308, name: "Damper", status: "owned", owner: null },
        { id: 13760867, name: "FC-23", status: "blocked", owner: "jdoe" },
      ],
      creates: ["_PE_DuctLosses project parameter"],
    },
  },
};

test("a workshared preview discloses every borrow, how long it lasts, and who blocks", () => {
  const w = worksharingOf(preview)!;
  expect(borrowWords(w)).toBe("borrows 3 elements");
  const { container } = render(<WorksharingNote worksharing={w} />);
  const text = container.textContent!;
  expect(leaks(text)).toEqual([]);
  expect(text).toContain("commit borrows 3 elements from the cloud central");
  expect(text).toContain("until you sync with central or relinquish");
  expect(text).toContain("borrows MUAS 10");
  expect(text).toContain("borrows Project Information");
  expect(text).toContain("creates _PE_DuctLosses project parameter");
  expect(text).not.toContain("Damper");
  expect(text).toContain("FC-23 is borrowed by jdoe");
});

test("a non-workshared preview carries no disclosure and the commit says nothing extra", () => {
  expect(worksharingOf({ response: { writes: [] } })).toBeNull();
  expect(borrowWords(null)).toBeNull();
  expect(borrowWords({ cloud: false, elements: [{ id: 1, name: "x", status: "owned" }], creates: [] })).toBeNull();
});
