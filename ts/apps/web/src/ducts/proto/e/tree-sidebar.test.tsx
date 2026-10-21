// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { GoTo } from "./tree-sidebar";

afterEach(cleanup);

test("go to: Enter hands the field to go and says where it went", () => {
  const go = vi.fn((q: string) => (q === "FC-17" ? "10 in SA 19" : `${q}: not in this snapshot`));
  render(<GoTo go={go} />);
  const field = screen.getByRole("textbox");
  fireEvent.change(field, { target: { value: "FC-17" } });
  fireEvent.keyDown(field, { key: "a" });
  expect(go).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: "Enter" });
  expect(go).toHaveBeenCalledWith("FC-17");
  expect(screen.getByText("10 in SA 19")).toBeTruthy();
  fireEvent.change(field, { target: { value: "nope" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(screen.getByText("nope: not in this snapshot")).toBeTruthy();
});
