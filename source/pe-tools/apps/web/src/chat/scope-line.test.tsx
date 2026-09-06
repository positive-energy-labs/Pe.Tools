// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("#/workbench/provider", () => ({
  useWorkbench: () => ({
    revit: false,
    currentThreadId: "t",
    isRunning: false,
    chat: { messages: [], display: {} },
  }),
}));
vi.mock("#/chat/scope", () => ({
  useThreadScope: () => ({
    scope: { kind: "none" },
    revision: 0,
    hydrated: true,
    set: vi.fn(),
    refusal: null,
  }),
}));

import { ScopeLine } from "./scope-line";

afterEach(cleanup);

/** Each `?scope=` fixture draws its resolution kind; the derived case draws the only Revit's document. */
function mount(kind: string) {
  cleanup();
  window.history.replaceState(null, "", `/chat?source=fixture&scope=${kind}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ScopeLine live={false} />
    </QueryClientProvider>,
  );
  return screen.getByTestId("scope-head");
}

test("the to-line names the resolution kind and draws the Revit only when it matters", () => {
  expect(mount("resolved").getAttribute("data-scope")).toBe("resolved");
  expect(screen.getByTestId("scope-head").textContent).toContain("project-a Residence.rvt");
  expect(screen.getByTestId("scope-head").textContent).not.toContain("Revit 2025");
  expect(screen.getByTestId("scope-revision").textContent).toBe("r3");

  expect(mount("ambiguous").getAttribute("data-scope")).toBe("ambiguous");
  expect(screen.getByTestId("scope-head").textContent).toContain("2 Revits — pick one");

  expect(mount("unheld").getAttribute("data-scope")).toBe("unheld");
  expect(screen.getByTestId("scope-head").textContent).toContain("not open");

  // Nothing chosen, three Revits up: unchosen, and the document slot is the placeholder.
  expect(mount("unchosen").getAttribute("data-scope")).toBe("unchosen");
  expect(screen.getByTestId("scope-head").textContent).toContain("a document");
});
