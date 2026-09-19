// @vitest-environment jsdom
/**
 * F-S-1 (hold 3, D5 part 3): a push where one cell landed and one was refused as stale reads
 * "partly applied", never "failed"; the written cell reads back as its new value in the grid, and
 * the refused cell keeps its staged value.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";

import { appAtomRegistry } from "#/route";
import { cellsApplied, setup } from "../../../../host/tests/schedule-test-fixture";
import { detailResponse, target } from "../../../../host/tests/schedule-fixture";
import { LiveScheduleGridWorkspace } from "./live";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
const sources: { close(): void }[] = [];
afterEach(() => {
  cleanup();
  for (const source of sources.splice(0)) source.close();
});

test("a partial push reads partly applied, the written cell reads back new, the stale one stays staged", async () => {
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
  // Two rows, each one editable Load cell behind its own element.
  const twoRows = (load1: string) => {
    const detail = detailResponse();
    const row1 = detail.entries[0]!.rows[0]!;
    row1.values = ["P-1", load1];
    row1.bindings[0]!.displayValue = load1;
    const row2 = structuredClone(row1);
    row2.rowNumber = 2;
    row2.values = ["P-2", "200 VA"];
    row2.subjectIds = [9];
    row2.bindings[0]!.targetElementIds = [9];
    row2.bindings[0]!.displayValue = "200 VA";
    row2.bindings[0]!.targets = [target(9, "200")];
    detail.entries[0]!.rows.push(row2);
    detail.page = { totalCount: 2, returnedCount: 2, isTruncated: false };
    return detail;
  };
  f.setDetail(twoRows("100 VA"));
  const reading = await f.read();
  await f.patch([
    { path: ["basis"], value: { captureId: reading.id } },
    { path: ["cells"], value: {} },
  ]);
  const mounted = render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <LiveScheduleGridWorkspace
        workspaceId={f.scope.work}
        target={JSON.stringify({ kind: "open", ref: f.b })}
      />
    </RegistryContext.Provider>,
  );
  await screen.findByText("bridge connected");
  for (const [from, to] of [
    ["100 VA", "175 VA"],
    ["200 VA", "275 VA"],
  ] as const) {
    const cell = await screen.findByDisplayValue(from);
    await act(async () => {
      fireEvent.change(cell, { target: { value: to } });
      fireEvent.blur(cell);
    });
  }
  await vi.waitFor(async () => expect(Object.keys((await f.view()).doc.cells)).toHaveLength(2));
  // Revit writes row 1 and refuses row 2 as stale; its readback holds row 1's new value.
  f.setResponse(
    cellsApplied([
      [1, 2, true],
      [2, 2, false, "Expected target evidence is stale."],
    ]),
  );
  f.setDetail(twoRows("175 VA"));
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "push 2 to Revit" }).hasAttribute("disabled")).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "push 2 to Revit" }));
  await vi.waitFor(
    () =>
      expect(document.body.textContent).toContain(
        "partly applied: 1 written, 1 refused: 2::2: Expected target evidence is stale.",
      ),
    { timeout: 10_000 },
  );
  expect(document.body.textContent).not.toMatch(/push failed|· Failed ·/);
  // The run line lists what this push wrote; the refused cell reads refused, never before → after.
  const run = screen.getByText(/^push run ·/).textContent!;
  expect(run).toContain("1::2 100 VA → 175 VA");
  expect(run).toContain("2::2 refused (Expected target evidence is stale.)");
  expect(run).not.toMatch(/2::2 [^,]*→/);
  const doc = (await f.view()).doc;
  expect(doc.cells["1::2"]?.staged).toBeUndefined();
  expect(doc.cells["2::2"]?.staged?.value).toBe("275 VA");
  // Fresh: the written cell reads back as Revit now holds it; the refused one is still staged.
  await screen.findByDisplayValue("175 VA", undefined, { timeout: 10_000 });
  expect(screen.getByDisplayValue("275 VA")).toBeTruthy();
  mounted.unmount();
}, 30_000);
