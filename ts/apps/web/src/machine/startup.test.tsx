// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { StartupSettings } from "./startup";
import { machineOf } from "./model";
import { MACHINE_SEEDS } from "#/open/seeds";

const host = vi.hoisted(() => ({ surface: "web", native: false, overlay: false }));
vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => host }));
beforeEach(() => {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 Chrome/155 Safari/537.36 Edg/155.0",
  );
});
afterEach(() => {
  cleanup();
  host.surface = "web";
  host.native = false;
  host.overlay = false;
  vi.restoreAllMocks();
});

test("other Chromium browsers do not offer a second app installation", () => {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 Chrome/155 Safari/537.36",
  );
  render(<StartupSettings machine={machineOf(MACHINE_SEEDS["no-revit"])} fixture={false} />);
  const prompt = vi.fn();
  fireEvent(
    window,
    Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt }),
  );
  expect(screen.queryByRole("button", { name: "Install in Edge" })).toBeNull();
  expect(screen.getByLabelText("startup settings").textContent).toContain(
    "Open this address in Microsoft Edge",
  );
  expect(prompt).not.toHaveBeenCalled();
});

test("Startup renders host observation and captured browser install capability", () => {
  const machine = machineOf(MACHINE_SEEDS["no-revit"]);
  const prompt = vi.fn(async () => {});
  render(<StartupSettings machine={machine} fixture={false} />);
  expect(screen.getByLabelText("startup settings").textContent).toContain("Start at login: on.");
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.queryByRole("button", { name: "Install in Edge" })).toBeNull();
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt });
  fireEvent(window, event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Install in Edge" }));
  expect(prompt).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Install in Edge" })).toBeNull();
  fireEvent(window, Object.assign(new Event("beforeinstallprompt"), { prompt }));
  fireEvent(window, new Event("appinstalled"));
  expect(screen.queryByRole("button", { name: "Install in Edge" })).toBeNull();
});

test.each([
  { surface: "tray", native: false },
  { surface: "pwa", native: false },
  { surface: "web", native: true },
])("installed/native surface $surface exposes no invented browser install action", (capability) => {
  Object.assign(host, capability);
  render(<StartupSettings machine={machineOf(MACHINE_SEEDS["no-revit"])} fixture={false} />);
  const prompt = vi.fn();
  fireEvent(window, Object.assign(new Event("beforeinstallprompt"), { prompt }));
  expect(screen.queryByRole("button", { name: "Install in Edge" })).toBeNull();
  expect(prompt).not.toHaveBeenCalled();
});

test("a dismissed browser choice reports no installation and consumes that prompt", async () => {
  render(<StartupSettings machine={machineOf(MACHINE_SEEDS["no-revit"])} fixture={false} />);
  expect(screen.getByText(/If no install button appears/).textContent).toContain(
    "Edge menu > Apps > Install this site as an app",
  );
  const prompt = vi.fn(async () => {});
  fireEvent(
    window,
    Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Install in Edge" }));
  });
  expect(screen.getByRole("status").textContent).toBe(
    "Installation dismissed. The app was not installed.",
  );
  expect(screen.queryByRole("button", { name: "Install in Edge" })).toBeNull();
  expect(prompt).toHaveBeenCalledOnce();
});

test("accepted consent waits for appinstalled and never claims taskbar pinning", async () => {
  render(<StartupSettings machine={machineOf(MACHINE_SEEDS["no-revit"])} fixture={false} />);
  const prompt = vi.fn(async () => ({ outcome: "accepted" }));
  fireEvent(
    window,
    Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Install in Edge" }));
  });
  expect(screen.getByRole("status").textContent).toContain(
    "Waiting for the browser to confirm completion",
  );
  fireEvent(window, new Event("appinstalled"));
  expect(screen.getByRole("status").textContent).toBe(
    "App installation completed in this Edge profile. Taskbar pinning remains your choice in Edge.",
  );
});

test("app display mode alone says window mode without certifying installed state", () => {
  host.surface = "pwa";
  render(<StartupSettings machine={machineOf(MACHINE_SEEDS["no-revit"])} fixture={false} />);
  expect(screen.getByText(/This is an app window/)).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "Install in Edge" })).toBeNull();
});

test("an app window under Edge's title bar names the toggle and the manifest-less reinstall", () => {
  host.surface = "pwa";
  render(<StartupSettings machine={machineOf(MACHINE_SEEDS["no-revit"])} fixture={false} />);
  expect(screen.getByLabelText("startup settings").textContent).toContain(
    "with no chevron, Edge installed it without the app manifest: uninstall it in Edge and use Install to taskbar again",
  );
  host.overlay = true;
  cleanup();
  render(<StartupSettings machine={machineOf(MACHINE_SEEDS["no-revit"])} fixture={false} />);
  expect(screen.getByLabelText("startup settings").textContent).not.toContain("chevron");
});
