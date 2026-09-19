// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";

import { appAtomRegistry } from "#/route";
import { setup } from "../../../../host/tests/schedule-test-fixture";
import { detailResponse, target } from "../../../../host/tests/schedule-fixture";
import { LiveScheduleGridWorkspace } from "./live";
import { REOPENED, schedulesManifest } from "./manifest";
import { ScheduleGridWorkspace, type ScheduleGridState } from "./workspace";
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
        // The document is the thread's; this test pins it instead of standing up a head.

        target={JSON.stringify({ kind: "open", ref: f.b })}
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
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(1);
  await f.patch([{ path: ["cells", "1::2", "proposal"], value: { value: "180 VA" } }]);
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
    expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(2),
  );
  await vi.waitFor(async () => expect((await f.view()).doc.cells["1::2"].staged).toBeUndefined());
  expect(f.sent.every((s) => s.session === "B" && s.openId === "open-B")).toBe(true);
  mounted.unmount();
});

test("F-H5-1..3: a dead-lifetime Work says read again; the bare verb re-reads the open schedule, rebinds, marks a changed cell stale with accept/deny, and the grid draws the new reading", async () => {
  // F-H5-2: the Situation presses a verb with no input.
  const manifest = schedulesManifest();
  expect(manifest.actions!.refresh.input.safeParse(undefined)).toMatchObject({ success: true });
  expect(manifest.actions!.catalog.input.safeParse(undefined)).toMatchObject({ success: true });
  // Q4, the contract: the read that rebinds is the person's; listing writes nothing.
  expect(manifest.actions!.refresh.actor).toBe("human");
  expect(manifest.actions!.catalog.actor).toBe("any");

  const f = await setup(); // 1::2 staged "150 VA" under the open-B reading
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
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  f.reopen();
  const live = { session: "B", openId: "reopened-B" };
  let state: ScheduleGridState | undefined;
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <LiveScheduleGridWorkspace
        workspaceId={f.scope.work}
        target={JSON.stringify({ kind: "open", ref: live })}
        render={(next) => {
          state = next;
          return <ScheduleGridWorkspace state={next} />;
        }}
      />
    </RegistryContext.Provider>,
  );
  await screen.findByText("bridge connected");
  await screen.findByText("P-1");
  // F-H5-1: the dead binding refuses before dispatch, by a reason that names the way out.
  await vi.waitFor(() => expect(state?.blockedBecause).toBe(REOPENED));
  expect(REOPENED).toBe(
    "Re-opened in Revit since this was staged: read the schedule again. Changed cells come back marked stale.",
  );

  // The model moved while closed: Mark reads P-2, Load reads 120 VA.
  const next = detailResponse();
  const row = next.entries[0].rows[0];
  row.values = ["P-2", "120 VA"];
  row.bindings[0] = {
    ...row.bindings[0],
    rawValue: "120",
    displayValue: "120 VA",
    targets: [target(7, "120"), target(8, "120")],
  };
  f.setDetail(next);
  // The bare verb reads the open schedule and rebinds in one write; the changed cell is marked stale.
  await act(async () => {
    expect(await state!.execute("refresh")).toBeNull();
  });
  // F-H5-2: no input still reads the open schedule, not the active view.
  expect(
    f.sent.filter((s) => s.key === "revit.detail.schedules").at(-1)!.input.query,
  ).toMatchObject({
    kind: "ScheduleReferences",
    scheduleIds: [42],
  });
  const fresh = (await f.captures.scheduleWork(f.scope.work)) as { id: string };
  expect((await f.view()).doc).toMatchObject({
    basis: { captureId: fresh.id, stale: ["1::2"] },
    cells: { "1::2": { staged: { value: "150 VA" } } },
  });
  // Drawn as drift against the live value, with the ruled accept/deny.
  const accept = await screen.findByRole("button", { name: "accept" });
  expect(screen.getByRole("button", { name: "deny" })).toBeTruthy();
  // Drift is drawn by the kit StateCell; its note rides the hover title at row scale.
  expect((await screen.findAllByTitle(/accept to stage it again/)).length).toBeGreaterThan(0);
  // Accept re-stages the value and drops the key from stale.
  fireEvent.click(accept);
  await vi.waitFor(async () => expect((await f.view()).doc.basis).toEqual({ captureId: fresh.id }));
  expect((await f.view()).doc.cells["1::2"].staged).toEqual({ value: "150 VA" });
  // F-H5-3: the grid draws the new reading, not the old basis.
  await screen.findByText("P-2");
  expect(screen.queryByText("P-1")).toBeNull();
});
