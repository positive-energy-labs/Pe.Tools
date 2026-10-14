// @vitest-environment jsdom
/**
 * The machine body over the recorded machine: Update opens by itself on a blocked plan and its
 * consent is refused while the blocker stands, the chip text says the version or the waiting
 * update, the host's absence is drawn as the honest gap, and the tray window wears no app chrome.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Machine, Reading } from "@pe/agent-contracts";

import { acknowledgeUpdate } from "#/host/install";
import { alignRevitBootstrap, switchRemoteAdministration, switchShare } from "#/host/machine";
import { Button } from "@pe/kit/lang/button";
import { GENERATED_FROM } from "@pe/host-contracts/pe-revit-contract";
import { BootstrapAlignment } from "./bootstrap";
import { MACHINE_SEEDS, BAY_YOURS_25 } from "#/open/seeds";
import { AppChrome, AppDevtools } from "#/route/app-chrome";

import { SettingsBody } from "./body";
import { chipText, machineOf, shareState } from "./model";
import { ShareSettings } from "./share";
import { UpdateGroup } from "./update";
import { settingsSearch } from "#/routes/settings";

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

describe("update client errors", () => {
  test("a recovery error carries the admitted identity instead of disappearing behind accepted", async () => {
    const { acknowledgeUpdate: admit } =
      await vi.importActual<typeof import("#/host/install")>("#/host/install");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { accepted: true, requestId: "exact-request", error: "receipt unavailable" },
          { status: 202 },
        ),
      ),
    );
    await expect(admit("plan")).rejects.toThrow("receipt unavailable (request exact-request)");
  });

  test("Recheck explicitly reads the feed and reports a failed acquisition", async () => {
    const { recheckUpdate } =
      await vi.importActual<typeof import("#/host/install")>("#/host/install");
    const fetch = vi.fn(async () => Response.json({ planLeg: { error: "feed unavailable" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(recheckUpdate()).rejects.toThrow("feed unavailable");
    expect(fetch).toHaveBeenCalledWith("/host/update?recheck=1", { headers: expect.any(Headers) });
  });
});

describe("groups", () => {
  test("Pea rows and header follow the same snapshot without a second provider fetch", () => {
    const machine = machineOf(MACHINE_SEEDS["no-revit"])!;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const rendered = body({ state: "ready", observation: machine });
    fireEvent.click(header("Pea providers"));
    expect(header("Pea providers").textContent).toContain("1 of 2 ready");
    expect(screen.getByText("Codex")).toBeTruthy();
    const next: Machine = {
      ...machine,
      providers: machine
        .providers!.filter((provider) => provider.id === "claude")
        .map((provider) => ({
          ...provider,
          readiness: { state: "unknown", message: "The last probe expired." },
        })),
    };
    rendered.rerender(
      <SettingsBody reading={{ state: "ready", observation: next }} fixture={false} shell="web" />,
    );
    expect(header("Pea providers").textContent).toContain("no provider ready");
    expect(screen.queryByText("Codex")).toBeNull();
    expect(screen.getByText("○ The last probe expired.")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  test("a blocked plan opens Update by itself and leaves the rest folded", () => {
    body(MACHINE_SEEDS["blocked-plan"]);
    expect(header("Update").getAttribute("aria-expanded")).toBe("true");
    for (const label of ["Revit", "Share", "Pea providers"])
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

  test("with nothing waiting, the first group whose header disagrees opens by itself", () => {
    const machine = machineOf(MACHINE_SEEDS["no-revit"])!;
    body({
      state: "ready",
      observation: {
        ...machine,
        share: { ...machine.share!, state: "refused", desired: "off", refused: [] },
      },
    });
    expect(header("Share").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header("Share"));
    expect(header("Share").getAttribute("aria-expanded")).toBe("false");
  });

  test("on the route, a closed group stays closed though the address has no section", () => {
    const machine = machineOf(MACHINE_SEEDS["no-revit"])!;
    const reading = {
      state: "ready" as const,
      observation: {
        ...machine,
        share: {
          ...machine.share!,
          state: "refused" as const,
          desired: "off" as const,
          refused: [],
        },
      },
    };
    const choose = vi.fn();
    const view = render(
      <SettingsBody reading={reading} fixture={false} shell="tray" onGroup={choose} />,
    );
    expect(header("Share").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header("Share"));
    expect(choose).toHaveBeenLastCalledWith(undefined);
    view.rerender(<SettingsBody reading={reading} fixture={false} shell="tray" onGroup={choose} />);
    expect(header("Share").getAttribute("aria-expanded")).toBe("false");
  });

  test("nothing waiting and nothing disagreeing opens nothing", () => {
    body(MACHINE_SEEDS["no-revit"]);
    for (const label of ["Revit", "Update", "Share", "Pea providers"])
      expect(header(label).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("Nothing waits on you.");
  });
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
  const said = (name: keyof typeof MACHINE_SEEDS) => chipText(MACHINE_SEEDS[name]);
  expect(said("blocked-plan")).toBe("Installed · 0.7.0 · identity unverified · 0.7.1 ready");
  expect(said("waiting-plan")).toBe("Installed · 0.7.0 · identity unverified · 0.7.1 ready");
  expect(said("receipt-handoff")).toBe("Installed · 0.7.0 · identity unverified");
  expect(said("disconnected")).toBe("Installed · 0.7.0 · stale");
  expect(said("no-revit")).toBe("Installed · 0.7.0 · identity unverified");
  expect(chipText({ state: "absent" })).toBe("");
});

test("the version chip badges a waiting plan and clears it otherwise", () => {
  const setAppBadge = vi.fn().mockResolvedValue(undefined);
  const clearAppBadge = vi.fn().mockResolvedValue(undefined);
  // On the real navigator: a prototype-chained copy throws from jsdom's own getters (`platform`).
  Object.assign(navigator, { setAppBadge, clearAppBadge });
  history.replaceState(null, "", "/open?demo=waiting-plan");
  render(<AppChrome />);
  expect(setAppBadge).toHaveBeenCalledOnce();
  cleanup();
  history.replaceState(null, "", "/open?demo=no-revit");
  render(<AppChrome />);
  expect(clearAppBadge).toHaveBeenCalledOnce();
  history.replaceState(null, "", "/");
  for (const name of ["setAppBadge", "clearAppBadge"]) Reflect.deleteProperty(navigator, name);
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
  expect(screen.getByRole("button", { name: "recheck" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
});

describe("sharing", () => {
  test("a refused desired-on share can be cancelled and its separate admin preference is visible", () => {
    const initial = machineOf(MACHINE_SEEDS["no-revit"])!;
    const machine: Machine = {
      ...initial,
      share: {
        ...initial.share!,
        desired: "on",
        state: "refused",
        url: null,
        refusal: { code: "share.unavailable", detail: "Synthetic unavailable" },
      },
    };
    render(<ShareSettings machine={machine} fixture={false} stale={false} />);
    const sharing = screen.getByRole("switch", { name: "Share over tailnet" });
    expect(sharing.getAttribute("aria-checked")).toBe("true");
    expect(sharing.hasAttribute("disabled")).toBe(false);
    fireEvent.click(sharing);
    expect(switchShare).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("switch", { name: "Allow remote machine administration" }));
    expect(switchRemoteAdministration).toHaveBeenCalledWith(false);
  });

  test("a machine without Tailscale says so plainly: not a refusal, no caution tone", () => {
    const initial = machineOf(MACHINE_SEEDS["no-revit"])!;
    const machine: Machine = {
      ...initial,
      share: { ...initial.share!, desired: "off", state: "needs-tailscale", refusal: null },
    };
    expect(shareState(machine)).toEqual({ text: "needs Tailscale" });
    render(<ShareSettings machine={machine} fixture={false} stale={false} />);
    const note = screen.getByText(/Sharing needs Tailscale/);
    expect(note.textContent).toContain("tailscale.com/download");
    expect(note.hasAttribute("data-tone")).toBe(false);
    expect(screen.queryByText(/refus/i)).toBeNull();
    expect(
      screen.getByRole("switch", { name: "Share over tailnet" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

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
  beforeEach(() => history.replaceState(null, "", "/?demo=blocked-plan"));
  afterEach(() => history.replaceState(null, "", "/"));

  test("tray Settings shares the feedback controller", () => {
    render(
      <>
        <SettingsBody reading={MACHINE_SEEDS["no-revit"]} fixture shell="tray" />
        <AppChrome />
      </>,
    );
    expect(screen.getByRole("button", { name: "feedback" })).toBeTruthy();
  });

  test("the floating launcher is absent in the tray and clear of Open", () => {
    const { rerender } = render(<AppDevtools pathname="/settings" shell="tray" />);
    expect(screen.queryByTestId("devtools-launcher")).toBeNull();
    rerender(<AppDevtools pathname="/open" />);
    expect(screen.queryByTestId("devtools-launcher")).toBeNull();
    rerender(<AppDevtools pathname="/family" />);
    expect(screen.getByTestId("devtools-launcher")).toBeTruthy();
  });

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

test("canonical sections reject unknown query values and keep exact session identity", () => {
  expect(settingsSearch({ section: "revit", session: "pid:18244", variant: "1" })).toEqual({
    section: "revit",
    session: "pid:18244",
  });
  expect(settingsSearch({ section: "invented", session: "" })).toEqual({
    section: undefined,
    session: undefined,
  });
  expect(settingsSearch({ subject: "machine", section: "pea" })).toEqual({
    section: "pea",
    session: undefined,
  });
});

test("Settings configures in place: documents go to Open, share and providers stay here", () => {
  body(MACHINE_SEEDS["patch-bay"]);
  fireEvent.click(header("Revit"));
  expect(screen.queryByLabelText("patch bay")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open documents and binding" }));
  expect(go).toHaveBeenCalledWith("/open");
  fireEvent.click(header("Share"));
  expect(screen.getByLabelText("sharing settings")).toBeTruthy();
  fireEvent.click(header("Pea providers"));
  expect(screen.getByPlaceholderText("API key")).toBeTruthy();
  expect(go).toHaveBeenCalledTimes(1);
});

test("canonical Settings section selection follows the address without hidden accordion state", () => {
  const choose = vi.fn();
  const tree = (section?: "update" | "host") => (
    <SettingsBody
      reading={MACHINE_SEEDS["blocked-plan"]}
      fixture
      shell="web"
      group={section}
      onGroup={choose}
    />
  );
  const view = render(tree("update"));
  fireEvent.click(header("Host"));
  expect(choose).toHaveBeenLastCalledWith("host");
  expect(header("Update").getAttribute("aria-expanded")).toBe("true");
  view.rerender(tree("host"));
  expect(header("Host").getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(header("Host"));
  expect(choose).toHaveBeenLastCalledWith(undefined);
  view.rerender(tree());
  expect(header("Host").getAttribute("aria-expanded")).toBe("false");
  expect(header("Update").getAttribute("aria-expanded")).toBe("false");
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
