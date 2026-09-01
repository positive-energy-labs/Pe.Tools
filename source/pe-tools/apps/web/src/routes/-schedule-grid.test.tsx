// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { fireEvent, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { appAtomRegistry } from "#/state/registry";
import { ScheduleGridRouteContent, scheduleGridSearch } from "./schedule-grid";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("literal schedule-grid fixture renders and edits dense local state without Host calls", () => {
  const fetchMock = vi.fn();
  const eventSource = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", eventSource);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });

  expect(scheduleGridSearch({ source: "fixture", thread: " review " })).toEqual({
    source: "fixture",
    thread: "review",
  });
  expect(scheduleGridSearch({ source: "Fixture" }).source).toBeUndefined();
  expect(scheduleGridSearch({ source: "fixture " }).source).toBeUndefined();

  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <ScheduleGridRouteContent source="fixture" />
    </RegistryContext.Provider>,
  );

  const text = document.body.textContent ?? "";
  expect(text).toContain("Mechanical Equipment Schedule");
  expect(text).toContain("5×7");
  expect(text).toContain("VAV Terminal 12in");
  expect(text).toContain("Rooftop AHU");
  expect(text).toContain("Cabinet Unit Heater");
  expect(text).toContain("2 proposed");
  expect(text).toContain("2 staged");
  expect(screen.getAllByTitle(/blocked: TypeParameter/)).toHaveLength(7);
  expect(screen.getAllByTitle(/calculated/).length).toBeGreaterThan(0);

  fireEvent.click(screen.getAllByRole("button", { name: "approve" })[0]!);
  expect(document.body.textContent).toContain("1 proposed");
  expect(document.body.textContent).toContain("3 staged");

  fireEvent.change(screen.getByDisplayValue("300 CFM"), { target: { value: "325 CFM" } });
  fireEvent.blur(screen.getByDisplayValue("325 CFM"));
  expect(document.body.textContent).toContain("4 staged");

  fireEvent.click(screen.getByRole("button", { name: "re-list" }));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(eventSource).not.toHaveBeenCalled();
});
