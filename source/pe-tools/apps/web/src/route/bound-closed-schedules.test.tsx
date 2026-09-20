// @vitest-environment jsdom
/**
 * F-X-1 (4k-2 b): /schedules bound to a closed document opens nothing and says why. Its own
 * file: a mount in another test's registry would be answered by that test's retained Readings.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";

import { appAtomRegistry } from "#/route";
import { dirty } from "#/readings";
import { setup } from "../../../host/tests/schedule-test-fixture";
import { LiveScheduleGridWorkspace } from "./schedules/live";

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

test("/schedules with a closed binding opens nothing and says why, in the one sentence", async () => {
  const f = await setup();
  stubBrowser(f.app);
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <LiveScheduleGridWorkspace target={JSON.stringify({ kind: "open", ref: f.b })} />
    </RegistryContext.Provider>,
  );
  await screen.findByText("bridge connecting", undefined, { timeout: 10_000 });
  await vi.waitFor(() => expect(screen.queryByText(/Select an available document/)).toBeNull(), {
    timeout: 10_000,
  });
  f.reopen();
  dirty({ kind: "inventory" });
  await vi.waitFor(
    () =>
      expect(
        screen.getByText(/the document this page was bound to closed \(Same · open-B/),
      ).toBeTruthy(),
    { timeout: 10_000 },
  );
}, 30_000);
