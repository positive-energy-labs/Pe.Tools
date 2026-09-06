// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MastraClient } from "@mastra/client-js";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("#/workbench/use-mode", () => ({ useMode: () => ["threads", vi.fn()] }));
vi.mock("#/chat/scope", () => ({
  useThreadScope: () => ({
    scope: { kind: "none" },
    revision: 0,
    hydrated: true,
    set: vi.fn(),
    refusal: null,
  }),
}));

import { appAtomRegistry } from "#/state/registry";
import { ChatRouteContent, chatSearchSchema } from "./chat";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("literal chat fixture renders varied production turns without controller or network calls", async () => {
  const fetch = vi.fn();
  const eventSource = vi.fn();
  const controller = vi.spyOn(MastraClient.prototype, "getAgentController");
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("EventSource", eventSource);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );

  expect(chatSearchSchema.parse({ source: "fixture" }).source).toBe("fixture");
  expect(chatSearchSchema.parse({ source: "Fixture" }).source).toBeUndefined();
  expect(chatSearchSchema.parse({ source: "fixture " }).source).toBeUndefined();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RegistryContext.Provider value={appAtomRegistry}>
        <ChatRouteContent source="fixture" />
      </RegistryContext.Provider>
    </QueryClientProvider>,
  );

  await waitFor(() =>
    expect(document.body.textContent).toContain("Inspect the active Level 2 mechanical view"),
  );
  const text = document.body.textContent ?? "";
  expect(text).toContain("Run the bounded check and keep the evidence");
  expect(text).toContain("Draft the schedule update, but ask before anything writes");
  expect(text).toContain("Receipt op-20260830-1842 captured 47 visible elements");
  expect(text).toContain("Apply the reviewed schedule update");
  expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Context budget/ })).toBeTruthy();
  expect(document.querySelector('[data-tool-id="tool-read"]')).toBeTruthy();
  expect(document.querySelector('[data-tool-id="tool-receipt"]')).toBeTruthy();
  expect(document.querySelector('[data-tool-id="tool-approval"]')).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
  expect(eventSource).not.toHaveBeenCalled();
  expect(controller).not.toHaveBeenCalled();
});
