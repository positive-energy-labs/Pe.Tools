// @vitest-environment jsdom
/**
 * Freshness is a per-document change mark, not a timer (design-system ledger, 2026-09-22).
 * Its own file: the app atom registry is per module, and the change marks are module state.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";

import { appAtomRegistry } from "#/route";
import { forgetMarks, isChanged, markChanged } from "#/host/changed";
import { setup, stubEventSource } from "../../../../host/tests/schedule-test-fixture";
import { LiveScheduleGridWorkspace } from "./live";
import { ScheduleGridWorkspace, type ScheduleGridState } from "./workspace";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
afterEach(() => {
  cleanup();
  forgetMarks();
});

const TAKEN = "2026-09-22T12:00:00.000Z";
const AT = Date.parse(TAKEN);

test("the mark comparison: a Reading is changed only when its document changed after it was taken", () => {
  expect(isChanged(null, TAKEN)).toBe(false); // never marked
  expect(isChanged(AT - 1, TAKEN)).toBe(false); // the change is older than the read
  expect(isChanged(AT, TAKEN)).toBe(false); // the read already saw it
  expect(isChanged(AT + 1, TAKEN)).toBe(true);
  expect(isChanged(AT, null)).toBe(true); // a marked document with nothing read yet
});

test("a change marks only the document it names", () => {
  markChanged("B", ["open-B"], AT + 1);
  expect(isChanged(null, TAKEN)).toBe(false);
  forgetMarks();
});

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

  // Focus, twice, on an unmarked document: nothing is read under the hands.
  state!.onFocus.grid();
  state!.onFocus.grid();
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(ran).not.toContain("refresh");

  // Revit changes THIS document after the read was taken.
  markChanged(f.b.session, [f.b.openId], Date.now() + 1000);
  await vi.waitFor(() => expect(state?.freshness).toBe("changed"));
  state!.onFocus.grid();
  await vi.waitFor(() => expect(ran).toContain("refresh"));
});
