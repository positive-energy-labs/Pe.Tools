// @vitest-environment jsdom
import type { Machine, Reading } from "@pe/agent-contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { acknowledgeUpdate } from "#/host/install";
import { alignRevitBootstrap, switchRemoteAdministration, switchShare } from "#/host/machine";
import { BAY_YOURS_25, MACHINE_SEEDS } from "#/open/seeds";
import { GENERATED_FROM } from "@pe/host-contracts/pe-revit-contract";
import { Button } from "@pe/kit/lang/button";
import { BootstrapAlignment } from "./bootstrap";

import { SettingsBody } from "./body";
import { machineOf } from "./model";
import { ShareSettings } from "./share";
import { UpdateGroup } from "./update";

const surface = vi.hoisted(() => ({ surface: "web", native: false }));
const go = vi.hoisted(() => vi.fn());
vi.mock("#/navigation/state", () => ({ useDestination: () => go }));
vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => surface }));

vi.mock("#/host/machine", async (original) => ({
  ...(await original<typeof import("#/host/machine")>()),
  alignRevitBootstrap: vi.fn(async () => ({ id: "alignment", state: "succeeded" })),
  switchShare: vi.fn(async () => {}),
  switchRemoteAdministration: vi.fn(async () => {}),
}));

vi.mock("#/host/install", () => ({
  acknowledgeUpdate: vi.fn(async () => "request-1"),
  recheckUpdate: vi.fn(async () => {}),
}));
vi.mock("#/components/feedback-picker", () => ({
  FeedbackPicker: () => <Button label="feedback">feedback</Button>,
}));
vi.mock("@tanstack/react-devtools", () => ({
  TanStackDevtools: () => <div data-testid="devtools-launcher" />,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  surface.native = false;
});

const body = (reading: Reading<Machine>, shell: "web" | "tray" = "web") =>
  render(<SettingsBody reading={reading} fixture={false} shell={shell} />);

const header = (label: string) =>
  within(screen.getByRole("region", { name: label })).getAllByRole("button")[0]!;

test("frozen Settings does not open a host transport for lifecycle controls", async () => {
  const source = vi.fn();
  const fetch = vi.fn();
  vi.stubGlobal("EventSource", source);
  vi.stubGlobal("fetch", fetch);
  render(<SettingsBody reading={MACHINE_SEEDS["blocked-plan"]} fixture shell="tray" />);
  await Promise.resolve();
  expect(screen.getByRole("group", { name: "settings groups" })).toBeTruthy();
  expect(source).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

describe("consent", () => {
  test("receipt recovery failure retains request identity without a confirmed receipt", () => {
    const machine = machineOf(MACHINE_SEEDS["no-revit"])!;
    render(
      <UpdateGroup
        reading={{
          state: "ready",
          observation: {
            ...machine,
            update: {
              ...machine.update,
              requestId: "exact-request",
              receipt: null,
              receiptLeg: {
                observedAtUtc: null,
                attemptedAtUtc: "2026-10-10T00:00:00Z",
                error: "op unavailable",
              },
            },
          },
        }}
        fixture={false}
      />,
    );
    expect(screen.getByLabelText("update receipt").textContent).toContain("exact-request");
    expect(screen.getByLabelText("update receipt").textContent).toContain(
      "Receipt read failed: op unavailable",
    );
  });

  test("a verified update retains restoration warnings", () => {
    const machine = machineOf(MACHINE_SEEDS["receipt-handoff"])!;
    render(
      <UpdateGroup
        reading={{
          state: "ready",
          observation: {
            ...machine,
            update: {
              ...machine.update,
              receipt: {
                ...machine.update.receipt!,
                state: "ok",
                legs: [
                  {
                    name: "reopen:cloud",
                    status: "failed",
                    observedAtUtc: "2026-10-10T00:00:00Z",
                    detail: "Reopen failed",
                    exitCode: 1,
                  },
                ],
              },
            },
          },
        }}
        fixture={false}
      />,
    );
    expect(screen.getByLabelText("update receipt").textContent).toContain(
      "Updated. Some documents or the app did not reopen",
    );
  });
  test("is refused while a blocker stands, with the blocking Revit's pid", () => {
    body(MACHINE_SEEDS["blocked-plan"]);
    const blocker = screen.getByLabelText("blocker");
    expect(blocker.textContent).toContain("pid 2501");
    expect(blocker.textContent).toContain("project-a Tower.rvt");
    expect(
      screen.getByText(
        "Revit is open. Update saves your work, restarts Revit and reopens your documents.",
      ),
    ).toBeTruthy();
    const consent = screen.getByRole("button", { name: /^Update$/ });
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

describe("sharing", () => {
  test("fixtures and disconnected controls cannot change sharing or administration", () => {
    const machine = machineOf(MACHINE_SEEDS["no-revit"])!;
    render(<ShareSettings machine={machine} fixture={true} stale={false} />);
    for (const control of screen.getAllByRole("switch")) {
      expect(control.hasAttribute("data-disabled")).toBe(true);
      fireEvent.click(control);
    }
    expect(switchShare).not.toHaveBeenCalled();
    expect(switchRemoteAdministration).not.toHaveBeenCalled();
  });
});

describe("shells", () => {
  beforeEach(() => history.replaceState(null, "", "/?fixture=blocked-plan"));
  afterEach(() => history.replaceState(null, "", "/"));

  test("only a native tray capability can quit the host and open a window", () => {
    body(MACHINE_SEEDS["no-revit"], "tray");
    fireEvent.click(header("Host"));
    for (const name of ["open window", "quit host"])
      expect(screen.getByRole("button", { name }).getAttribute("aria-disabled")).toBe("true");
    cleanup();
    surface.native = true;
    body(MACHINE_SEEDS["no-revit"], "tray");
    fireEvent.click(header("Host"));
    for (const name of ["open window", "quit host"])
      expect(screen.getByRole("button", { name }).getAttribute("aria-disabled")).toBeNull();
    cleanup();
    body(MACHINE_SEEDS["no-revit"], "web");
    fireEvent.click(header("Host"));
    for (const name of ["open window", "quit host"])
      expect(screen.getByRole("button", { name }).getAttribute("aria-disabled")).toBe("true");
  });
});

const bootstrapBase = Object.values(MACHINE_SEEDS).find((seed) => seed.state === "ready")!;
const bootstrapEmpty = {
  ...(bootstrapBase as { observation: Machine }).observation,
  revit: { years: [2025], sessions: [], unclassifiedAttachments: [] },
} as Machine;

test("Machine installs the selected year only after explicit confirmation of the pinned SDK", async () => {
  render(<BootstrapAlignment machine={bootstrapEmpty} refusal={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Align Revit 2025 add-ins with this build" }));
  expect(alignRevitBootstrap).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: `Install Revit 2025 add-ins for SDK ${GENERATED_FROM}` }),
  );
  expect(alignRevitBootstrap).toHaveBeenCalledWith("2025", GENERATED_FROM);
  expect(await screen.findByText(/receipt alignment/)).toBeTruthy();
});

test("Machine names the open Revit that refuses alignment", () => {
  render(
    <BootstrapAlignment
      machine={{ ...bootstrapEmpty, revit: { ...bootstrapEmpty.revit, sessions: [BAY_YOURS_25] } }}
      refusal={null}
    />,
  );
  const button = screen.getByRole("button", { name: "Align Revit 2025 add-ins with this build" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(alignRevitBootstrap).not.toHaveBeenCalled();
  expect(screen.getByText(/Close.*Revit 2025.*18244/)).toBeTruthy();
});
