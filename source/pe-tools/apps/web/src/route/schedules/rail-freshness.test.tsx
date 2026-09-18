// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import { scheduleCatalogSchema } from "@pe/agent-contracts";

import { appAtomRegistry, useRoute, type RouteHandle } from "#/route";
import { previousOf } from "#/readings";
import { DEMO_PODS, DEMO_SPEC_PATH } from "#/route/seeds";
import { setup } from "../../../../host/tests/schedule-test-fixture";
import { schedulesManifest } from "./manifest";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));

// The apply's host workflow is the only double: it adds a schedule to the document the fixture
// host lists, exactly as a real `schedule.apply` does in Revit. Everything else is the real lane.
const applied = vi.hoisted(() => ({ add: () => {} }));
vi.mock("../../../../../packages/mcps/src/shared/takeoff-action-client", async (actual) => ({
  ...(await actual<object>()),
  runSemanticAction: async (key: string) => {
    if (key !== "schedule.apply") throw Error(`Unexpected ${key}`);
    applied.add();
    return { state: "succeeded", result: {} };
  },
}));

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

test("an apply refreshes the rail's catalog count from Revit, without a re-list or reload", async () => {
  const f = await setup();
  stubBrowser(f.app);
  applied.add = () => f.addSchedule(43, "Air Terminals");
  let route!: RouteHandle<unknown, string, unknown, string>;
  function Rail() {
    route = useRoute(schedulesManifest(), {
      target: JSON.stringify({ kind: "open", ref: f.b }),
      page: { stage: "apply", pod: "mech-standards", path: DEMO_SPEC_PATH },
      provided: { pods: { state: "ready", observation: DEMO_PODS } },
    }) as never;
    // The rail's count is the length of this reading, as the workspace draws it.
    const catalog = previousOf(route.readings.catalog);
    return (
      <span data-testid="rail-count">
        {catalog ? scheduleCatalogSchema.parse(catalog).schedules.length : "—"}
      </span>
    );
  }
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <Rail />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(() => expect(screen.getByTestId("rail-count").textContent).toBe("1"), {
    timeout: 10_000,
  });
  const listed = f.sent.filter((s) => s.key === "revit.catalog.schedules").length;
  await act(async () => {
    expect(await route.actions.apply!.run()).toBeNull();
  });
  await vi.waitFor(() => expect(screen.getByTestId("rail-count").textContent).toBe("2"), {
    timeout: 10_000,
  });
  // A fresh read of the same source, not a local increment.
  expect(f.sent.filter((s) => s.key === "revit.catalog.schedules").length).toBeGreaterThan(listed);
}, 30_000);
