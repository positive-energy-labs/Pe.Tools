// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { type Machine } from "@pe/agent-contracts";
import { MACHINE_SEEDS } from "#/open/seeds";
import { machineOf } from "./model";
import { PeaGroup, ProviderSetup } from "./pea";
import { MachinePage } from "./page";
import { harnessClient } from "#/workbench/provider/harness-client";
import { FirstOpenCard } from "#/chat/first-open";
import { HeadLadder } from "#/chat/head-chips";
import { Route as Settings } from "#/routes/settings";

const state = vi.hoisted(() => ({
  machine: null as Machine | null,
  login: vi.fn(),
  logins: {} as Record<string, import("#/workbench/provider/providers").Login>,
  go: vi.fn(),
}));
vi.mock("#/navigation/state", () => ({ useDestination: () => state.go }));
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
    login: state.logins,
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
  vi.clearAllMocks();
  state.logins = {};
});

test("Machine shows provider health and real repair actions while Settings owns credentials", () => {
  render(<PeaGroup fixture={false} machine={seed()} />);
  expect(screen.getByLabelText("provider health")).toBeTruthy();
  expect(screen.queryByPlaceholderText("API key")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  expect(state.login).toHaveBeenCalledWith("codex");
  fireEvent.click(screen.getByRole("button", { name: "Configure providers" }));
  expect(state.go).toHaveBeenCalledWith("/settings?subject=machine&section=providers");
});
test("composer first-open uses the same provider setup", () => {
  seed();
  render(<FirstOpenCard providers={providers()} origin="http://host" />);
  setup();
});
test("settings still exists and projects the provider setup", async () => {
  seed();
  const search = vi.spyOn(Settings, "useSearch").mockReturnValue({ subject: undefined });
  const Component = Settings.options.component!;
  await act(async () => {
    render(<Component />);
  });
  // The route loads lazily; under a whole-workspace run the default 1 s wait is marginal.
  await screen.findByLabelText("providers", undefined, { timeout: 10_000 });
  setup();
  search.mockRestore();
});

test("direct scoped Settings projects the declared provider controller after Machine Page unmounts", async () => {
  const machine = seed();
  const view = render(
    <MachinePage reading={{ state: "ready", observation: machine }} fixture={false} shell="web" />,
  );
  view.unmount();
  const search = vi
    .spyOn(Settings, "useSearch")
    .mockReturnValue({ subject: "machine", section: "providers" });
  const Component = Settings.options.component!;
  await act(async () => {
    render(<Component />);
  });
  expect(screen.getByRole("region", { name: "Providers and access" })).toBeTruthy();
  expect(screen.queryByLabelText("sharing settings")).toBeNull();
  expect(screen.queryByLabelText("startup settings")).toBeNull();
  setup();
  search.mockRestore();
});
test("the tray page projects provider health from the same machine snapshot", () => {
  render(
    <MachinePage reading={{ state: "ready", observation: seed() }} fixture={false} shell="tray" />,
  );
  const pea = screen.getByRole("region", { name: "Pea" });
  const toggle = within(pea).getAllByRole("button")[0]!;
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  expect(screen.getByLabelText("provider health")).toBeTruthy();
  expect(screen.queryByPlaceholderText("API key")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  expect(state.login).toHaveBeenCalledWith("codex");
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
      Response.json(
        {
          error: {
            code: "route.refused",
            message: failure.message,
            details: { step: "endpoint", failure },
          },
        },
        { status: 400 },
      ),
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
  fireEvent.change(screen.getByPlaceholderText("OpenAI API"), { target: { value: "test endpoint" } });
  fireEvent.change(screen.getByPlaceholderText("API key"), { target: { value: "test-key" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(failure.message);
  expect(screen.queryByText(failure.raw)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Raw error" }));
  expect(screen.getByText(failure.raw)).toBeTruthy();
  vi.unstubAllGlobals();
});
test("Manage providers from the model picker navigates to canonical Settings", () => {
  seed();
  render(<HeadLadder />);
  fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
  fireEvent.click(screen.getByRole("button", { name: "Manage providers" }));
  expect(state.go).toHaveBeenCalledWith("/settings?subject=machine&section=providers");
});
test("a blank name saves under the endpoint's own name, and the key is the only thing to type", () => {
  seed();
  const add = vi.fn();
  render(<ProviderSetup providers={{ ...providers(), add }} />);
  fireEvent.change(screen.getByPlaceholderText("API key"), { target: { value: "sk-test" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(add).toHaveBeenCalledWith({
    harness: "codex",
    name: "OpenAI API",
    auth: { kind: "endpoint", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" },
  });
});
test("Sign in says what it is doing under its row, then goes quiet once a probe answers", () => {
  seed();
  state.logins = { codex: { state: "open", probedAt: null } };
  const view = render(<ProviderSetup providers={providers()} />);
  expect(screen.getByText(/Finish installer in the console that opened/)).toBeTruthy();
  state.logins = {
    codex: { state: "failed", message: "Could not open the Codex installer console: nope" },
  };
  view.rerender(<ProviderSetup providers={providers()} />);
  expect(screen.getByText(/Could not open the Codex installer console: nope/)).toBeTruthy();
});
test("the model picker offers each unavailable harness's own Install or Sign in", () => {
  seed();
  render(<HeadLadder />);
  fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
  fireEvent.click(screen.getByRole("button", { name: "Install Codex" }));
  expect(state.login).toHaveBeenCalledWith("codex");
  expect(screen.queryByRole("button", { name: /^(Install|Sign in) Claude/ })).toBeNull();
});
