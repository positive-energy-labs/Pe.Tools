// @vitest-environment jsdom
// Drive 10 fix line 4: why Attach PDF is refused was only in the button's description.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { AttachPdf } from "./attach-pdf";

afterEach(cleanup);

test("a refused Attach PDF says why on the page, and stops saying it once it can run", () => {
  const view = render(<AttachPdf open={false} onAttach={() => {}} />);
  expect(screen.getByText("Choose a saved family")).toBeTruthy();
  view.rerender(<AttachPdf open onAttach={() => {}} />);
  expect(screen.getByText("Enter a PDF path or URL")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "C:/cut.pdf" } });
  expect(screen.queryByText("Enter a PDF path or URL")).toBeNull();
});
