// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { DevicePairing } from "../machine/devices";

afterEach(cleanup);

test("pairing names the environment and requires both human approval code and device name", () => {
  render(<DevicePairing environmentId="office-environment" connected={() => {}} />);
  expect(screen.getByText("Environment office-environment")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Pair device" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Device name" }), {
    target: { value: "Laptop" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Pairing code" }), {
    target: { value: "human-approved-code" },
  });
  expect(
    screen.getByRole("button", { name: "Pair device" }).getAttribute("aria-disabled"),
  ).not.toBe("true");
  expect(screen.getByText(/shared Page or capture does not pair/)).toBeTruthy();
});
