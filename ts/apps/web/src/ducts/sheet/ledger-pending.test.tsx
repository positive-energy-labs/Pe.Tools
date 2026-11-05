// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import type { LedgerProps } from "./types";
import { Ledger } from "./view";
import { openSheetSchema } from "../neutral";
import fixture from "./sheet.fixture.json";

afterEach(cleanup);

test("a Work ESP is labelled by its resolved source, never as a Revit write", () => {
  const sheet = openSheetSchema.parse({
    overview: fixture.overview,
    inputs: fixture.inputs,
    elements: null,
    legs: null,
    worstLegs: [],
    worksheet: null,
  });
  const inputs = sheet.inputs!.inputs;
  inputs.units[String(sheet.overview.fan.unitId)] = {
    kind: { value: "muas", source: "default", units: null, version: null, status: "valid" },
    role: { value: "fan", source: "default", units: null, version: null, status: "valid" },
    cfm: { value: null, source: "none", units: "cfm", version: null, status: "missing" },
    esp: { value: 2.658079, source: "Work", units: "in-wg", version: 4, status: "valid" },
  };
  const view = render(
    <Ledger
      props={{
        sheet,
        inputs,
        busy: false,
        loading: false,
        error: null,
        blockers: [],
        taken: [],
        changeInputs() {},
        closerOf() {
          throw Error("No closer in this fixture");
        },
        close() {},
        closeMany() {},
        focusedBlocker: null,
        focusBlocker() {},
      }}
    />,
  );
  expect(view.getByText("required (Work)")).toBeTruthy();
  expect(view.getByText("2.6581")).toBeTruthy();
  expect(view.queryByText("required (written)")).toBeNull();
});
test("a recomputing sheet does not claim that no fan is open", () => {
  const props: LedgerProps = {
    sheet: null,
    busy: true,
    loading: false,
    error: null,
    blockers: [],
    taken: [],
    inputs: null,
    changeInputs() {},
    closerOf() {
      throw Error("No blocker in this fixture");
    },
    close() {},
    closeMany() {},
    focusedBlocker: null,
    focusBlocker() {},
  };
  const view = render(<Ledger props={props} />);
  expect(view.getByRole("status").textContent).toContain("computing");
  expect(view.queryByText("No fan open.")).toBeNull();
});
