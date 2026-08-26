// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";

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
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
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
