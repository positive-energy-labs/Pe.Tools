// @vitest-environment jsdom
/**
 * Freshness is a per-document change mark, not a timer (design-system ledger, 2026-09-22). The
 * host owns the mark and every document-bound Reading carries it on its envelope; this asserts
 * what the grid draws from that envelope, and what its focus edge does with it.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";

import { appAtomRegistry } from "#/route";
import { setup, stubEventSource } from "../../../../host/tests/schedule-test-fixture";
import { LiveScheduleGridWorkspace } from "./live";
import { ScheduleGridWorkspace, type ScheduleGridState } from "./workspace";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
afterEach(cleanup);

const TAKEN = "2026-09-22T12:00:00.000Z";

test("a marked grid says 'changed in Revit' and offers the re-read; an unmarked one says nothing", () => {
  const base = {
    slice: null,
    revision: null,
    hydrated: true,
    apply: async () => null,
    execute: async () => null,
    busy: null,
    snapshot: {
      scheduleName: "Loads",
      takenAt: TAKEN,
      columns: [],
      rows: [],
    } as unknown as ScheduleGridState["snapshot"],
    catalog: null,
    refused: {},
    onFocus: { rail: () => {}, grid: () => {} },
  } satisfies Omit<ScheduleGridState, "freshness">;

  const { rerender } = render(<ScheduleGridWorkspace state={{ ...base, freshness: "current" }} />);
  expect(screen.queryByText("changed in Revit")).toBeNull();
  expect(screen.queryByText("read again (r)")).toBeNull();
  expect(screen.queryByText("disconnected")).toBeNull();

  rerender(<ScheduleGridWorkspace state={{ ...base, freshness: "changed" }} />);
  expect(screen.getByText("changed in Revit")).toBeTruthy();
  expect(screen.getByText("read again (r)")).toBeTruthy();

  // A detached bridge knows nothing about the model; it is disconnected, never stale.
  rerender(<ScheduleGridWorkspace state={{ ...base, freshness: "disconnected" }} />);
  expect(screen.getByText("disconnected")).toBeTruthy();
  expect(screen.queryByText("changed in Revit")).toBeNull();
  expect(screen.queryByText("read again (r)")).toBeNull();
});

test("the focus rule: an unmarked pane's focus edge re-reads nothing; a marked one re-reads", async () => {
  const f = await setup();
  stubEventSource(f);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  let state: ScheduleGridState | undefined;
  const ran: (string | null)[] = [];
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <LiveScheduleGridWorkspace
        workspaceId={f.scope.work}
        target={JSON.stringify({ kind: "open", ref: f.b })}
        render={(next) => {
          state = next;
          ran.push(next.busy);
          return <ScheduleGridWorkspace state={next} />;
        }}
      />
    </RegistryContext.Provider>,
  );
  await screen.findByText("P-1");
  await vi.waitFor(() => expect(state?.freshness).toBe("current"));

  // A change to ANOTHER document is not this document's mark.
  f.revitChanged(f.a);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(state?.freshness).toBe("current");

  // Focus, twice, on an unmarked document: nothing is read under the hands.
  state!.onFocus.grid();
  state!.onFocus.grid();
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(ran).not.toContain("refresh");

  // Revit changes THIS document after the host served the Reading; the envelope says so.
  f.revitChanged(f.b);
  await vi.waitFor(() => expect(state?.freshness).toBe("changed"));
  state!.onFocus.grid();
  await vi.waitFor(() => expect(ran).toContain("refresh"));
});
