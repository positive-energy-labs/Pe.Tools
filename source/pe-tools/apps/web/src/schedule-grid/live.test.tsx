// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";

import { appAtomRegistry } from "#/route";
import { setup } from "../../../host/tests/schedule-test-fixture";
import { LiveScheduleGridWorkspace } from "./live";
import { ScheduleGridReview } from "#/workbench/plugins/schedule-grid-chat-plugin";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
const sources: { close(): void }[] = [];
afterEach(() => {
  cleanup();
  for (const source of sources.splice(0)) source.close();
});

test("real grid edits and shared Chat reviewer apply through HTTP, journal, Work and independent readback", async () => {
  const f = await setup();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  // Same SSE adapter as resource-consumer.test; the actual runtime owns all frames.
  class Source {
    onmessage: EventSource["onmessage"] = null;
    onerror: EventSource["onerror"] = null;
    onopen: EventSource["onopen"] = null;
    closed = false;
    abort = new AbortController();
    constructor(url: string) {
      sources.push(this);
      void (async () => {
        const response = await f.app.fetch(
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
              new MessageEvent("message", { data: new TextDecoder().decode(next.value).slice(6) }),
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
  }
  vi.stubGlobal("EventSource", Source);
  await f.patch([{ path: ["cells"], value: {} }]);
  const view = (review = false) => (
    <RegistryContext.Provider value={appAtomRegistry}>
      <LiveScheduleGridWorkspace
        workspaceId={f.scope.work}
        render={review ? (state) => <ScheduleGridReview state={state} /> : undefined}
      />
    </RegistryContext.Provider>
  );
  const mounted = render(view());
  await screen.findByText("bridge connected");
  await screen.findByDisplayValue("100 VA");
  const cell = screen.getByDisplayValue("100 VA");
  await act(async () => {
    fireEvent.change(cell, { target: { value: "175 VA" } });
    fireEvent.blur(cell);
  });
  await vi.waitFor(async () =>
    expect(
      (await f.view()).doc.cells["1::2"]?.staged?.value,
      JSON.stringify(f.requests.filter((r) => r.body)),
    ).toBe("175 VA"),
  );
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "push 1 to Revit" }).hasAttribute("disabled")).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "push 1 to Revit" }));
  await vi.waitFor(async () => expect((await f.view()).doc.cells["1::2"].staged).toBeUndefined());
  await screen.findByDisplayValue("100 VA"); // Native read fixture did NOT report the authored 175.
  expect(f.sent.filter((s) => s.key === "revit.apply.parameter-values")).toHaveLength(1);
  await f.patch([{ path: ["cells", "1::2", "proposal"], value: { value: "180 VA", by: "pea" } }]);
  mounted.rerender(view(true));
  await screen.findByRole("button", { name: "Approve" });
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await vi.waitFor(async () =>
    expect((await f.view()).doc.cells["1::2"].staged.value).toBe("180 VA"),
  );
  await screen.findByRole("button", { name: "Push 1 to Revit" });
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Push 1 to Revit" }).hasAttribute("disabled")).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Push 1 to Revit" }));
  await vi.waitFor(() =>
    expect(f.sent.filter((s) => s.key === "revit.apply.parameter-values")).toHaveLength(2),
  );
  await vi.waitFor(async () => expect((await f.view()).doc.cells["1::2"].staged).toBeUndefined());
  expect(f.sent.every((s) => s.session === "B" && s.openId === "open-B")).toBe(true);
  mounted.unmount();
});
