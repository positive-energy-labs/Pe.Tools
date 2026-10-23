// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, expect, test } from "vite-plus/test";
import { RevitTarget } from "../src/components/lang/revit-target";
import { Row } from "../src/components/lang/row";
import { FactChip } from "../src/components/lang/chip";
import { SubjectText } from "../src/components/lang/subject-text";
import { SubjectTextContext } from "../src/components/lang/reach";

afterEach(cleanup);
const scope = { document: { session: "session", openId: "captured-document" }, source: "native" };

test("Row ids, chip ids and subject tokens carry their captured scope through portals and null boundaries", () => {
  const view = render(
    <RevitTarget scope={scope}>
      {createPortal(<Row label="fitting" revit={[42, 43]} />, document.body)}
      <FactChip title="captured fitting" revit={[42]}>
        chip
      </FactChip>
      <SubjectTextContext value={{ nameOf: () => "fitting" }}>
        <SubjectText text="42" revit={[42]} />
      </SubjectTextContext>
      <RevitTarget scope={null}>
        <Row label="unscoped" revit={[99]} />
      </RevitTarget>
    </RevitTarget>,
  );
  const row = document.querySelector('.dl-row[data-revit-ids="42,43"]');
  expect(row?.getAttribute("data-revit-scope")).toBe(JSON.stringify(scope));
  expect(
    screen.getByText("chip").closest("[data-revit-ids]")?.getAttribute("data-revit-scope"),
  ).toBe(JSON.stringify(scope));
  expect(view.container.querySelector(".subject-ref")?.getAttribute("data-revit-ids")).toBe("42");
  expect(view.container.querySelector(".subject-ref")?.getAttribute("data-revit-scope")).toBe(
    JSON.stringify(scope),
  );
  expect(document.querySelector('[data-revit-ids="99"]')?.getAttribute("data-revit-scope")).toBe(
    "null",
  );
});
