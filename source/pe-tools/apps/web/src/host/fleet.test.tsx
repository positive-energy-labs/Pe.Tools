// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test } from "vite-plus/test";

import { useFleet } from "./fleet";

function FleetProbe({ enabled }: { enabled: boolean }) {
  useFleet({ enabled });
  return null;
}

test("capability admission gates every fleet request", async () => {
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(`${init?.method ?? "GET"} ${url}`);
    return Response.json(url === "/sessions" ? { result: { sessions: [] } } : { sessions: [] });
  };
  const mount = (enabled: boolean) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(FleetProbe, { enabled }),
      ),
    );
  };

  try {
    const disabled = mount(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual([]);
    disabled.unmount();

    mount(true);
    await waitFor(() => expect(requests.sort()).toEqual(["GET /sessions", "POST /call"]));
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});
