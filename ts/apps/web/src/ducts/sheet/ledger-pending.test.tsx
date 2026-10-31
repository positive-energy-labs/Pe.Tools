// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { Ledger } from "./view";
import type { SheetViewProps } from "./types";

afterEach(cleanup);
test("a recomputing sheet does not claim that no fan is open", () => {
  const props = {
    sheet: null,
    busy: true,
    loading: false,
    error: null,
    blockers: [],
  } as unknown as SheetViewProps;
  const view = render(<Ledger props={props} />);
  expect(view.getByRole("status").textContent).toContain("computing");
  expect(view.queryByText("No fan open.")).toBeNull();
});
