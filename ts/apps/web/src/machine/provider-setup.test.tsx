// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { type Machine } from "@pe/agent-contracts";
import { MACHINE_SEEDS } from "#/open/seeds";
import { machineOf } from "./model";
import { closeMachine } from "./door";
import { PeaGroup, ProviderSetup } from "./pea";
import { MachinePage } from "./page";
import { harnessClient } from "#/workbench/provider/harness-client";
import { FirstOpenCard } from "#/chat/first-open";
import { HeadLadder } from "#/chat/head-chips";
import { VersionChip } from "./drawer";
import { Route as Settings } from "#/routes/settings";

const state = vi.hoisted(() => ({ machine: null as Machine | null, login: vi.fn() }));
vi.mock("#/machine/use-machine", () => ({
  useMachine: () => ({ reading: { state: "ready", observation: state.machine }, fixture: false }),
  SEED_REFUSAL: "fixture",
}));
vi.mock("#/open/lifecycle", () => ({ useInstancesBasis: () => null, RevitControls: () => null }));
vi.mock("#/route", () => ({
  emptyManifest: () => ({}),
  RouteShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("#/workbench/provider/providers", async (original) => ({
  ...(await original<typeof import("#/workbench/provider/providers")>()),
  useProviders: () => providers(),
}));
vi.mock("#/workbench/provider", () => ({
  useWorkbench: () => ({
    chat: {},
    currentThreadId: null,
    threads: [],
    providers: providers(),
    draft: { providerId: "claude", modelId: null, traits: {} },
    setDraft: vi.fn(),
  }),
}));

function providers() {
  return {
    list: [...state.machine!.providers!],
    access: { guarded: true },
    error: undefined,
    probe: vi.fn(),
    openLogin: state.login,
    remove: vi.fn(),
    add: vi.fn(),
    setAccess: vi.fn(),
  };
}
function seed() {
  const machine = machineOf(MACHINE_SEEDS["no-revit"])!;
  state.machine = {
    ...machine,
    providers: machine.providers!.map((p) => ({
      ...p,
      readiness:
        p.id === "claude"
          ? { state: "ready" }
          : { state: "refused", step: "installed", message: "Codex is not installed" },
    })),
  };
  return state.machine;
}
function setup() {
  const region = screen.getByLabelText("providers");
  expect(within(region).getByRole("button", { name: "Install" })).toBeTruthy();
  expect(within(region).getByLabelText("base URL")).toBeTruthy();
  expect(within(region).getByPlaceholderText("API key")).toBeTruthy();
  fireEvent.click(within(region).getByRole("button", { name: "Install" }));
  expect(state.login).toHaveBeenCalledWith("codex");
}
afterEach(() => {
  cleanup();
  closeMachine();
  vi.clearAllMocks();
});

test("machine uses the provider setup with Install and endpoint credentials", () => {
  render(<PeaGroup fixture={false} machine={seed()} />);
  setup();
});
test("composer first-open uses the same provider setup", () => {
  seed();
  render(<FirstOpenCard providers={providers()} origin="http://host" />);
  setup();
});
test("settings still exists and projects the provider setup", async () => {
  seed();
  const Component = Settings.options.component!;
  await act(async () => {
    render(<Component />);
  });
  await screen.findByLabelText("providers");
  setup();
});
test("the tray page projects the same setup from its machine snapshot", () => {
  render(
    <MachinePage reading={{ state: "ready", observation: seed() }} fixture={false} shell="tray" />,
  );
  const pea = screen.getByRole("region", { name: "Pea" });
  const toggle = within(pea).getAllByRole("button")[0]!;
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  setup();
});
test("endpoint add shows one classified line and reveals the raw body only on demand", async () => {
  seed();
  const failure = {
    kind: "billing",
    message: "billing: Out of credit or billing limit reached.",
    raw: '{"error":{"type":"insufficient_quota"}}',
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ step: "endpoint", message: failure.message, failure }, { status: 400 }),
    ),
  );
  render(
    <ProviderSetup
      providers={{
        ...providers(),
        add: async (input) => {
          await harnessClient("").addProvider(input);
        },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(failure.message);
  expect(screen.queryByText(failure.raw)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Raw error" }));
  expect(screen.getByText(failure.raw)).toBeTruthy();
  vi.unstubAllGlobals();
});
test("a ready provider does not hide Install: model picker opens machine setup", () => {
  seed();
  render(
    <>
      <HeadLadder />
      <VersionChip hideTrigger />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
  fireEvent.click(screen.getByRole("button", { name: "Manage providers" }));
  setup();
});
