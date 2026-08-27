// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { LiveTakeoffsRoute } from "#/routes/takeoffs";
import { usePeInfo } from "./info";
import { useHostLiveInvalidation } from "./live";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("opens host events only after PeInfo confirms Revit", async () => {
  const sources: { close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal(
    "EventSource",
    class {
      close = vi.fn();
      constructor() {
        sources.push(this);
      }
    },
  );

  for (const revit of [false, true]) {
    let resolveInfo!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (resolveInfo = resolve))),
    );
    const mounted = render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(() => {
          useHostLiveInvalidation();
          return null;
        }),
      ),
    );

    expect(sources).toHaveLength(0);
    resolveInfo(
      Response.json({
        controllerId: "pea",
        resourceId: "local",
        capabilities: { revit },
        world: {
          id: "local",
          root: "C:/repo",
          storage: { kind: "local-unversioned" },
          isolation: "none",
        },
      }),
    );
    await waitFor(() => expect(sources).toHaveLength(revit ? 1 : 0));
    mounted.unmount();
  }

  expect(sources[0]?.close).toHaveBeenCalledOnce();
});

test("live Takeoffs does not open Revit wires before literal capability true", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json({
      controllerId: "pea",
      resourceId: "local",
      capabilities: { revit: false },
      world: {
        id: "local",
        root: "C:/repo",
        storage: { kind: "local-unversioned" },
        isolation: "none",
      },
    }),
  );
  const eventSource = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", eventSource);

  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(LiveTakeoffsRoute),
    ),
  );

  await waitFor(() => expect(document.body.textContent).toContain("Revit unavailable"));
  expect(fetchMock).toHaveBeenCalledOnce();
  const requestedUrls = fetchMock.mock.calls.map(([url]) =>
    typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
  );
  expect(requestedUrls[0]).toContain("/host/status");
  expect(requestedUrls.some((url) => new URL(url).pathname === "/sessions")).toBe(false);
  expect(eventSource).not.toHaveBeenCalled();
});

test("PeInfo reads host status with one-shot query failure", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 503, statusText: "Down" }));
  vi.stubGlobal("fetch", fetchMock);
  let error: Error | null = null;

  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(() => {
        error = usePeInfo().error;
        return null;
      }),
    ),
  );

  await waitFor(() => expect(error).toBeInstanceOf(Error));
  expect(fetchMock).toHaveBeenCalledOnce();
  const routeStore = readFileSync(join(process.cwd(), "src/state/route-store.ts"), "utf8");
  expect(routeStore).toContain("await fetchPeInfo(config)");
  expect(routeStore).not.toContain('peUrl(config, "/info")');
});
