// @vitest-environment jsdom
/**
 * The machine body over the recorded machine: Update opens by itself on a blocked plan and its
 * consent is refused while the blocker stands, the version chip says the version or the waiting
 * update, the host's absence is drawn as the honest gap, and the tray window wears no app chrome.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Machine, Reading } from "@pe/agent-contracts";

import { acknowledgeUpdate } from "#/host/install";
import { MACHINE_SEEDS } from "#/open/seeds";
import { AppChrome, AppDevtools } from "#/route/app-chrome";

import { MachineBody } from "./body";
import { chipText, machineOf } from "./model";
import { MachinePage } from "./page";

vi.mock("#/host/install", () => ({ acknowledgeUpdate: vi.fn(async () => "request-1") }));
vi.mock("#/open/lifecycle", async (original) => ({
  ...(await original<typeof import("#/open/lifecycle")>()),
  useInstancesBasis: () => null,
}));
vi.mock("#/components/feedback-picker", () => ({
  FeedbackPicker: () => <button>feedback</button>,
}));
vi.mock("@tanstack/react-devtools", () => ({
  TanStackDevtools: () => <div data-testid="devtools-launcher" />,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const body = (reading: Reading<Machine>, shell: "drawer" | "tray" = "drawer") =>
  render(<MachineBody reading={reading} fixture={false} shell={shell} />);

const header = (label: string) =>
  within(screen.getByRole("region", { name: label })).getAllByRole("button")[0]!;

describe("groups", () => {
  test("a blocked plan opens Update by itself and leaves the rest folded", () => {
    body(MACHINE_SEEDS["blocked-plan"]);
    expect(header("Update").getAttribute("aria-expanded")).toBe("true");
    for (const label of ["Revit", "Share", "Pea"])
      expect(header(label).getAttribute("aria-expanded")).toBe("false");
    expect(header("Update").textContent).toContain("0.7.1 · blocked");
    expect(screen.getByRole("status").textContent).toBe(
      "Update 0.7.1 blocked by project-a Tower.rvt.",
    );
  });

  test("one group open at a time", () => {
    body(MACHINE_SEEDS["blocked-plan"]);
    fireEvent.click(header("Revit"));
    expect(header("Revit").getAttribute("aria-expanded")).toBe("true");
    expect(header("Update").getAttribute("aria-expanded")).toBe("false");
  });

  test("nothing waiting opens nothing", () => {
    body(MACHINE_SEEDS["no-revit"]);
    for (const label of ["Revit", "Update", "Share", "Pea"])
      expect(header(label).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("Nothing waits on you.");
  });
});

describe("consent", () => {
  test("is refused while a blocker stands, with the blocking Revit's pid", () => {
    body(MACHINE_SEEDS["blocked-plan"]);
    const blocker = screen.getByLabelText("blocker");
    expect(blocker.textContent).toContain("pid 2501");
    expect(blocker.textContent).toContain("project-a Tower.rvt");
    const consent = screen.getByRole("button", { name: "close 3 Revits and update" });
    expect(
      consent.getAttribute("aria-disabled") === "true" || consent.hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(consent);
    expect(acknowledgeUpdate).not.toHaveBeenCalled();
  });

  test("binds the plan id when nothing blocks", () => {
    body(MACHINE_SEEDS["waiting-plan"]);
    fireEvent.click(screen.getByRole("button", { name: "close 3 Revits and update" }));
    expect(acknowledgeUpdate).toHaveBeenCalledWith("plan-20261008-1712-7f3a");
  });
});

test("the chip says the version, or the update that waits", () => {
  const said = (name: keyof typeof MACHINE_SEEDS) => chipText(machineOf(MACHINE_SEEDS[name]));
  expect(said("blocked-plan")).toBe("0.7.1 ready");
  expect(said("waiting-plan")).toBe("0.7.1 ready");
  expect(said("receipt-handoff")).toBe("Pe.Tools 0.7.0");
  expect(said("disconnected")).toBe("Pe.Tools 0.7.0");
  expect(said("no-revit")).toBe("Pe.Tools 0.7.0");
  expect(chipText(machineOf({ state: "absent" }))).toBe("Pe.Tools");
});

test("the version chip badges a waiting plan and clears it otherwise", () => {
  const setAppBadge = vi.fn().mockResolvedValue(undefined);
  const clearAppBadge = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator), { setAppBadge, clearAppBadge }),
  );
  history.replaceState(null, "", "/open?demo=waiting-plan");
  render(<AppChrome pathname="/open" />);
  expect(setAppBadge).toHaveBeenCalledOnce();
  cleanup();
  history.replaceState(null, "", "/open?demo=no-revit");
  render(<AppChrome pathname="/open" />);
  expect(clearAppBadge).toHaveBeenCalledOnce();
  history.replaceState(null, "", "/");
});

test("a host that went away is the honest gap: last confirmed leg, then disconnected", () => {
  body(MACHINE_SEEDS.disconnected);
  expect(screen.getByRole("status").textContent).toContain(
    "The host stopped answering after 17:12",
  );
  expect(header("Update").getAttribute("aria-expanded")).toBe("true");
  const receipt = screen.getByLabelText("update receipt");
  expect(receipt.textContent).toContain("Last confirmed handoff at 17:20 · disconnected");
  const unobserved = [...receipt.querySelectorAll("[data-seam]")].map((chip) => chip.textContent);
  expect(unobserved).toEqual(["install", "reopen", "relaunch"]);
  expect(screen.getByRole("button", { name: "recheck" }).hasAttribute("disabled")).toBe(true);
});

describe("shells", () => {
  beforeEach(() => history.replaceState(null, "", "/?demo=blocked-plan"));
  afterEach(() => history.replaceState(null, "", "/"));

  test("the tray page fills and scrolls its viewport without a feedback picker", () => {
    render(
      <>
        <MachinePage reading={MACHINE_SEEDS["no-revit"]} fixture shell="tray" />
        <AppChrome pathname="/machine" />
      </>,
    );
    const main = screen.getByRole("main", { name: "machine" });
    expect(main.className).toContain("w-full");
    expect(main.className).toContain("overflow-y-auto");
    expect(main.className).not.toContain("w-[380px]");
    expect(screen.queryByRole("button", { name: "feedback" })).toBeNull();
  });

  test("the tray window wears no app chrome; every other page wears the version chip", () => {
    const { container } = render(<AppChrome pathname="/machine" />);
    expect(container.innerHTML).toBe("");
    cleanup();
    render(<AppChrome pathname="/open" />);
    const chip = screen.getByRole("button", { name: "0.7.1 ready" });
    fireEvent.click(chip);
    expect(screen.getByRole("complementary", { name: "this machine" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "this machine" })).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  test("the floating launcher is absent in the tray and clear of Open", () => {
    const { rerender } = render(<AppDevtools pathname="/machine" shell="tray" />);
    expect(screen.queryByTestId("devtools-launcher")).toBeNull();
    rerender(<AppDevtools pathname="/open" />);
    expect(screen.queryByTestId("devtools-launcher")).toBeNull();
    rerender(<AppDevtools pathname="/family" />);
    expect(screen.getByTestId("devtools-launcher")).toBeTruthy();
  });

  test("only the tray shell can quit the host and open a window", () => {
    body(MACHINE_SEEDS["no-revit"], "tray");
    for (const name of ["open window", "quit host"])
      expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(false);
    cleanup();
    body(MACHINE_SEEDS["no-revit"], "drawer");
    for (const name of ["open window", "quit host"])
      expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
  });

  test("install appears only for a captured prompt in the drawer", () => {
    let standalone = false;
    vi.stubGlobal("matchMedia", () => ({ matches: standalone }));
    const prompt = vi.fn().mockResolvedValue(undefined);
    body(MACHINE_SEEDS["no-revit"]);
    expect(screen.queryByRole("button", { name: "Install as app" })).toBeNull();
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Install as app" }));
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Install as app" })).toBeNull();
    fireEvent(window, Object.assign(new Event("beforeinstallprompt"), { prompt }));
    expect(screen.getByRole("button", { name: "Install as app" })).toBeTruthy();
    fireEvent(window, new Event("appinstalled"));
    expect(screen.queryByRole("button", { name: "Install as app" })).toBeNull();
    cleanup();
    body(MACHINE_SEEDS["no-revit"], "tray");
    fireEvent(window, Object.assign(new Event("beforeinstallprompt"), { prompt }));
    expect(screen.queryByRole("button", { name: "Install as app" })).toBeNull();
    cleanup();
    standalone = true;
    body(MACHINE_SEEDS["no-revit"]);
    fireEvent(window, Object.assign(new Event("beforeinstallprompt"), { prompt }));
    expect(screen.queryByRole("button", { name: "Install as app" })).toBeNull();
  });
});
