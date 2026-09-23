// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { fireEvent, render, screen } from "@testing-library/react";
import { FamiliesReadStatus } from "./read-status";

test("a failed saved read offers retry and reveals diagnostics on request", async () => {
  const retry = vi.fn();
  const raw = 'Error: { "code": "invalid_union", "discriminator": "binding" }';
  render(<FamiliesReadStatus reading={null} error={raw} retry={retry} />);
  expect(screen.getByRole("alert").textContent).toContain("Couldn't load this saved read.");
  expect(screen.getByRole("alert").textContent).not.toContain("invalid_union");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Error details" }));
  expect((await screen.findByRole("dialog")).textContent).toContain(raw);
});
