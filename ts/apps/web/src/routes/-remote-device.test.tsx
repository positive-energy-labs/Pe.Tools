// @vitest-environment jsdom
import "../../../host/tests/device-test-home.ts";
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
    target: { value: "abcd-2345" },
  });
  expect(
    screen.getByRole("button", { name: "Pair device" }).getAttribute("aria-disabled"),
  ).not.toBe("true");
  expect(screen.getByText(/shared Page or capture does not pair/)).toBeTruthy();
});

test("a scanned URL fills the short code and clears the fragment; a pasted URL works too", () => {
  window.history.replaceState(null, "", "/#pair=ABCD2345");
  render(<DevicePairing environmentId="office-environment" connected={() => {}} />);
  const input = screen.getByRole("textbox", { name: "Pairing code" }) as HTMLInputElement;
  expect(input.value).toBe("ABCD2345");
  expect(window.location.hash).toBe("");
  fireEvent.change(input, { target: { value: "https://office.example/#pair=EFGH6789" } });
  expect(input.value).toBe("EFGH6789");
});
