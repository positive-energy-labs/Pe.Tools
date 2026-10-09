// @vitest-environment jsdom
/** First open: with every provider refused the card says why and offers each provider's own step. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { Provider } from "@pe/agent-contracts";

const { FirstOpenCard } = await import("./first-open");

afterEach(cleanup);

const provider = (id: string, readiness: Provider["readiness"], auth?: Provider["auth"]) =>
  ({
    id,
    harness: id.startsWith("claude") ? "claude" : "codex",
    name: id,
    auth: auth ?? { kind: "subscription" },
    readiness,
    models: [],
    traits: [],
    probedAt: null,
  }) satisfies Provider;

test("every provider refused: one row each, its own verb, the access switch, and the MCP door", () => {
  const providers = {
    list: [
      provider("claude", {
        state: "refused",
        step: "installed",
        message: "claude is not on your PATH",
      }),
      provider("codex", { state: "refused", step: "signed-in", message: "Codex is not signed in" }),
      provider(
        "codex-vps",
        { state: "refused", step: "endpoint", message: "HTTP 401" },
        { kind: "endpoint", baseUrl: "https://vps/v1", keyLast4: "abcd" },
      ),
      provider("claude-probe", { state: "unknown", message: "Not probed yet." }),
    ],
    access: { guarded: true },
    error: undefined,
    probe: vi.fn(),
    openLogin: vi.fn(),
    setAccess: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
  };
  render(<FirstOpenCard providers={providers} origin="http://127.0.0.1:57781" />);
  expect(screen.getByText("No provider is ready")).toBeTruthy();
  expect(screen.getByText("○ claude is not on your PATH")).toBeTruthy();
  fireEvent.click(screen.getByText("Install"));
  expect(providers.openLogin).toHaveBeenCalledWith("claude");
  fireEvent.click(screen.getByText("Sign in"));
  expect(providers.openLogin).toHaveBeenCalledWith("codex");
  expect(screen.getByText("Open providers")).toBeTruthy();
  fireEvent.click(screen.getByText("Probe"));
  expect(providers.probe).toHaveBeenCalledWith("claude-probe");
  expect(screen.getByText("Pea asks before each change")).toBeTruthy();

  fireEvent.click(screen.getByText("Use your own app"));
  expect(
    screen.getByText(
      "claude mcp add --transport stdio pea -- pea mcp --host http://127.0.0.1:57781",
    ),
  ).toBeTruthy();
  const desktop = JSON.parse(screen.getByText(/"mcpServers"/).textContent!);
  expect(desktop.mcpServers.pea).toEqual({
    command: "pea",
    args: ["mcp", "--host", "http://127.0.0.1:57781"],
  });
  expect(screen.getByText(/\[mcp_servers\.pea\]/).textContent).toContain('command = "pea"');
  expect(screen.queryByText(/does not serve MCP over HTTP yet/)).toBeNull();
});
