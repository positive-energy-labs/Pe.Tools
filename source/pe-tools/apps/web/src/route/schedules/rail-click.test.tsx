// @vitest-environment jsdom
/**
 * F-X-2: a pointer click on a /schedules rail row must OPEN the schedule (dispatch the read), not
 * only move the cursor. Real host fixture lane, a fresh page (no Work yet), and the click is the
 * browser's own event sequence on the row, never a call to `onPick`.
 */
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { appAtomRegistry } from "#/route";
import { setup } from "../../../../host/tests/schedule-test-fixture";
import { LiveScheduleGridWorkspace } from "./live";

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

/**
 * The browser's own sequence for a mouse click, including what jsdom skips: an unprevented
 * mousedown moves focus to the nearest focusable ancestor before the button comes back up.
 */
const pointerClick = (el: Element) => {
  fireEvent.pointerDown(el);
  if (fireEvent.mouseDown(el))
    el.closest<HTMLElement>("a,button,input,select,textarea,[tabindex]")?.focus();
  fireEvent.pointerUp(el);
  fireEvent.mouseUp(el);
  fireEvent.click(el);
};

test("a pointer click on a fresh page's rail row opens that schedule", async () => {
  const f = await setup();
  stubBrowser(f.app);
  // The live document's scale: hundreds of schedules, the one to open deep in the rail.
  for (let id = 100; id < 400; id += 1)
    f.addSchedule(id, id === 250 ? "Pumps Schedule" : `Schedule ${id}`);
  // A fresh page: no Work was created before the person arrives.
  // The real /schedules page: the framed route (Situation, verbs, rail), inside a router.
  const target = JSON.stringify({ kind: "open", ref: f.b });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <LiveScheduleGridWorkspace framed url={false} target={target} />,
    }),
    history: createMemoryHistory({ initialEntries: ["/schedules"] }),
  });
  await router.load();
  // The dev app renders under StrictMode (double render, double effects), as the live page did.
  render(
    <StrictMode>
      <RegistryContext.Provider value={appAtomRegistry}>
        <RouterProvider router={router} />
      </RegistryContext.Provider>
    </StrictMode>,
  );
  // The rail needs the catalog: list it through its real button, as a person does.
  await act(async () =>
    fireEvent.click(
      await screen.findByRole("button", { name: /list schedules/ }, { timeout: 10_000 }),
    ),
  );
  const row = await screen.findByRole("option", { name: /^Panel/ }, { timeout: 10_000 });
  const reads = () => f.sent.filter((s) => s.key === "revit.detail.schedules").length;
  const before = reads();
  await act(async () => pointerClick(row));
  // The gate: the open read is dispatched…
  await vi.waitFor(() => expect(reads()).toBeGreaterThan(before), { timeout: 10_000 });
  // …and the DOM shows it: the schedule is drawn (the fixture answers "Panel" to any read).
  await screen.findByText("Panel Schedule", undefined, { timeout: 10_000 });
}, 40_000);
