// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { LiveTakeoffsRoute } from "#/routes/takeoffs";
import { RootComponent } from "#/routes/__root";
import { usePeInfo } from "./info";
import { useHostLiveInvalidation } from "./live";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("fixture root mounts route content without Host wires while ordinary routing keeps them", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json({
      controllerId: "pea",
      resourceId: "local",
      capabilities: { revit: true },
      world: {
        id: "local",
        root: "C:/repo",
        storage: { kind: "local-unversioned" },
        isolation: "none",
      },
    }),
  );
  const eventSources: { close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "EventSource",
    class {
      close = vi.fn();
      constructor() {
        eventSources.push(this);
      }
    },
  );

  const mountRoot = (entry: string) => {
    const root = createRootRoute({ component: RootComponent });
    const index = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <p>route content</p>,
    });
    const router = createRouter({
      routeTree: root.addChildren([index]),
      history: createMemoryHistory({ initialEntries: [entry] }),
    });
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  };

  const fixture = mountRoot("/?source=fixture");
  expect(await screen.findByText("route content")).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(eventSources).toHaveLength(0);
  fixture.unmount();

  mountRoot("/");
  await screen.findByText("route content");
  await waitFor(() => expect(eventSources).toHaveLength(1));
  expect(fetchMock).toHaveBeenCalledOnce();
  const requested = fetchMock.mock.calls[0]?.[0];
  expect(
    typeof requested === "string"
      ? requested
      : requested instanceof URL
        ? requested.href
        : requested?.url,
  ).toContain("/host/status");
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
});
