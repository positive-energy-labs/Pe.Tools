// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { appAtomRegistry } from "#/state/registry";
import { createFixtureFamilyStore } from "#/family/fixture";
import { FamilyRouteContent, familySearch } from "./family";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("literal family fixture renders the canonical dense workspace without family RPCs", async () => {
  const fetchMock = vi.fn();
  const eventSource = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", eventSource);

  expect(familySearch({ source: "fixture" }).source).toBe("fixture");
  expect(familySearch({ source: "Fixture" }).source).toBeUndefined();
  expect(familySearch({ source: "fixture " }).source).toBeUndefined();
  expect(
    familySearch({
      source: "fixture",
      fixture: "box",
      capture: "true",
      thread: " review ",
      doc: "C:\\Models\\A.rfa",
      target: " ff-profile-proof-25 ",
    }),
  ).toEqual({
    source: "fixture",
    fixture: "box",
    capture: true,
    thread: "review",
    doc: "C:\\Models\\A.rfa",
    target: "ff-profile-proof-25",
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RegistryContext.Provider value={appAtomRegistry}>
        <FamilyRouteContent source="fixture" />
      </RegistryContext.Provider>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(document.body.textContent).toContain("FC42-cut-sheet.pdf"));
  const text = document.body.textContent ?? "";
  expect(text).toContain("fixture · no host");
  expect(text).toContain("7 grounded · 4 open · 3 types");
  expect(text).toContain("Body Width");
  expect(text).toContain("Compact");
  expect(text).toContain("Standard");
  expect(text).toContain("Tall");
  expect(
    fetchMock.mock.calls.every(([url]) =>
      ["/host/install", "/host/update", "http://localhost:3000/host/status"].includes(String(url)),
    ),
  ).toBe(true);
  expect(eventSource).not.toHaveBeenCalled();

  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  const store = createFixtureFamilyStore(registry);
  store.actions.setDraft((draft) => ({ ...draft, dirty: true }));
  await store.actions.save();
  expect(registry.get(store.atoms.draft).dirty).toBe(false);
  await expect(store.actions.bind("session:test")).rejects.toThrow(
    "fixture family writes are disabled",
  );
  expect(
    fetchMock.mock.calls.every(([url]) =>
      ["/host/install", "/host/update", "http://localhost:3000/host/status"].includes(String(url)),
    ),
  ).toBe(true);
  store.dispose();
  registry.dispose();
});

test("native fixture URLs render authored parameters through the route loader", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", vi.fn());
  for (const fixture of ["box", "grd", "bath", "refline"] as const) {
    const mounted = render(
      <QueryClientProvider client={new QueryClient()}>
        <RegistryContext.Provider value={appAtomRegistry}>
          <FamilyRouteContent source="fixture" fixture={fixture} />
        </RegistryContext.Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(document.body.textContent).not.toContain("No family document"));
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        fixture === "box" ? "Voltage" : fixture === "grd" ? "Duct Width" : "_conn",
      ),
    );
    expect(document.body.textContent).not.toContain("FC42-cut-sheet.pdf");
    expect(document.body.textContent).toContain("fixture");
    mounted.unmount();
  }
  expect(
    fetchMock.mock.calls.every(([url]) =>
      ["/host/install", "/host/update", "http://localhost:3000/host/status"].includes(String(url)),
    ),
  ).toBe(true);
});
