// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { machineNoticeSchema } from "@pe/host-contracts/native-adapter";
import { FailureNote } from "./failure-note";

afterEach(cleanup);

test("Details holds the raw text and its copy press, without the code block's language and line count", () => {
  // What the tray card receives: a receipt failure notice, as the native channel delivers it.
  const notice = machineNoticeSchema.parse({
    id: "receipt:1",
    revision: 1,
    title: "Revit open failed",
    body: "doc.bad-body: conflict belongs to a cloud open. The request named session a.",
  });
  const { container } = render(<FailureNote text={notice.body} onDoor={() => {}} />);
  expect(screen.getByText("Conflict belongs to a cloud open")).toBeTruthy();
  container.querySelector("details")!.open = true;
  expect(screen.getByRole("button", { name: "Copy the details" })).toBeTruthy();
  expect(screen.queryByText("plaintext")).toBeNull();
  expect(screen.queryByText(/1 line/)).toBeNull();
});
