// @vitest-environment jsdom
/** A PDF chip's name opens the PDF in the browser; every other file chip stays a plain label. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { AttachmentChip } from "./attachment-chip";

afterEach(cleanup);

const pdf = { name: "spec.pdf", mimeType: "application/pdf", size: 9, data: "JVBERi0xLjcK" };

test("pressing a PDF chip's name opens a blob URL in a new tab", () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const create = vi.fn((_blob: Blob) => "blob:http://pe/spec");
  URL.createObjectURL = create;
  URL.revokeObjectURL = vi.fn();
  render(<AttachmentChip attachment={pdf} onRemove={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Open spec.pdf" }));
  expect(create.mock.calls[0]![0].type).toBe("application/pdf");
  expect(open).toHaveBeenCalledWith("blob:http://pe/spec", "_blank", "noopener");
});

test("a non-PDF file chip has no open press", () => {
  render(
    <AttachmentChip
      attachment={{ name: "sizes.csv", mimeType: "text/csv", size: 7, text: "a,b" }}
      onRemove={() => {}}
    />,
  );
  expect(screen.queryByRole("button", { name: /^Open/ })).toBeNull();
});
