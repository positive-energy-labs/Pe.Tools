// @vitest-environment jsdom
/**
 * F-X-1: a route bound to a document that went away says so, in one sentence, and its verbs
 * refuse with it. The same title open under a new openId is offered first; never auto-rebound.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { appAtomRegistry, useRoute, type RouteHandle } from "#/route";
import { dirty } from "#/readings";
import { useDocumentLadder } from "#/route/situation";
import { setup } from "../../../host/tests/schedule-test-fixture";
import { schedulesManifest } from "./schedules/manifest";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));

const sources: { close(): void }[] = [];
afterEach(async () => {
  cleanup();
  for (const source of sources.splice(0)) source.close();
  await new Promise((resolve) => setTimeout(resolve, 450));
});

function stubBrowser(app: { fetch: (request: Request) => Response | Promise<Response> }) {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal(
    "EventSource",
    class {
      onmessage: EventSource["onmessage"] = null;
      onerror: EventSource["onerror"] = null;
      onopen: EventSource["onopen"] = null;
      closed = false;
      abort = new AbortController();
      constructor(url: string) {
        sources.push(this);
        void (async () => {
          const response = await app.fetch(
            new Request(new URL(url, "http://host"), { signal: this.abort.signal }),
          );
          const reader = response.body!.getReader();
          this.onopen?.call(this as unknown as EventSource, new Event("open"));
          try {
            while (!this.closed) {
              const next = await reader.read();
              if (next.done) break;
              this.onmessage?.call(
                this as unknown as EventSource,
                new MessageEvent("message", {
                  data: new TextDecoder().decode(next.value).slice(6),
                }),
              );
            }
          } catch {
            /* closing cancels production stream */
          }
        })();
      }
      close() {
        this.closed = true;
        this.abort.abort();
      }
    },
  );
}

test("a route bound to a closed document says so, refuses its verbs, and offers the reopened one", async () => {
  const f = await setup();
  stubBrowser(f.app);
  let route!: RouteHandle<any, any, any, any>;
  let ladder!: ReturnType<typeof useDocumentLadder>;
  function Probe() {
    route = useRoute(schedulesManifest(), {
      target: JSON.stringify({ kind: "open", ref: f.b }),
    }) as never;
    ladder = useDocumentLadder(route);
    return null;
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Probe }),
    history: createMemoryHistory({ initialEntries: ["/schedules"] }),
  });
  await router.load();
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(() => expect(route.resolution.kind).toBe("resolved"), { timeout: 10_000 });

  // The person closes and reopens the model: the same title, a new openId.
  f.reopen();
  dirty({ kind: "inventory" });
  const sentence = /the document this page was bound to closed \(Same · open-B/;
  await vi.waitFor(() => expect(route.actions.push.refusal).toMatch(sentence), {
    timeout: 10_000,
  });
  expect(route.actions.push.refusal).toMatch(/bind it again in the sentence above/);
  expect(route.actions.push.refusal).not.toMatch(/hydrated/);
  expect(route.bindingLost?.sentence).toMatch(sentence);
  // Offered first, never taken: the route stays on the closed binding until the person picks.
  const documents = ladder.levels.find((level) => level.key === "document")!;
  expect(documents.options?.[0]).toMatchObject({ id: "reopened-B", label: "Same" });
  expect(route.resolution.kind).not.toBe("resolved");
}, 30_000);
