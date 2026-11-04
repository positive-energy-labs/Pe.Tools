// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import type { LedgerProps } from "./types";
import { Ledger } from "./view";

afterEach(cleanup);
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
