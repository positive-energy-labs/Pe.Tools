// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { expect, test } from "vite-plus/test";

import { useTarget } from "../src/host/use-target";

test("chat target waits for the Revit capability before listing bridge sessions", async () => {
  const requests: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(init?.body as string));
    return Response.json({ sessions: [] });
  };
  let resolution: ReturnType<typeof useTarget>["resolution"] | undefined;
  const mount = (revit: boolean | undefined) =>
    render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(() => {
          resolution = useTarget("", revit === true).resolution;
          return null;
        }),
      ),
    );

  try {
    for (const revit of [false, undefined]) {
      const disabled = mount(revit);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requests).toEqual([]);
      expect(resolution).toEqual({ kind: "unresolved", selector: "", reason: "no-sessions" });
      disabled.unmount();
    }

    mount(true);
    await waitFor(() => expect(requests).toEqual([{ key: "bridge.sessions.list" }]));
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});
