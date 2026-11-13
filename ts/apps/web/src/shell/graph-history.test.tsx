// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { bindWork, draftCellSchema, workFingerprintSchema, workTimelineSchema } from "@pe/agent-contracts";
import { module as reference } from "../fans/route";
import { route } from "../route/typed-route";
import { scrollBody } from "../route/body";
import { BandOutlet, RouteControlsProvider } from "../navigation/route-controls";
import { createFixtureWorkDoor } from "./fixture-work-door";
import { GraphHistory } from "./graph-history";
import type { TimelineOwner } from "./situation-band";
import { TypedChrome } from "./typed-shell";
import { mountTypedRoute } from "./typed-mount";
import { createTimelineClient } from "./work-feed-client";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("consumed edits show not written, and only Pea's edit says rejected", () => {
  const work = bindWork("notes", null, "one");
  const timeline = workTimelineSchema.parse({ rows: [
    { kind: "edit", work, revision: 1, by: "human", label: "Human input", state: "applied", at: 0,
      notWritten: { invocation: "write", reason: "rejected by person", rejected: false } },
    { kind: "edit", work, revision: 2, by: "pea", label: "Pea input", state: "applied", at: 1,
      notWritten: { invocation: "write", reason: "rejected by person", rejected: true } },
  ], undo: null, redo: null, refusal: { undo: null, redo: null } });
  const owner: TimelineOwner = {
    subscribe: () => () => {}, revision: () => 0, timeline: () => timeline,
    timelineRefusal: () => null, reviewProblem: () => null, stepTimeline: async () => null,
    pendingEdits: () => [], discardIntent: () => {}, stopCommand: async () => { throw Error("No running command"); },
  };
  render(<GraphHistory owner={owner} />);
  expect(screen.getByText(/notes \/ you \/ not written \/ r1/)).toBeTruthy();
  expect(screen.getByText(/notes \/ Pea \/ not written \/ rejected \/ r2/)).toBeTruthy();
  expect(screen.queryByText(/\/ applied \//)).toBeNull();
});

test("Ctrl+Z reports a failed HTTP restore in the Undo button's result display", async () => {
  const schema = z.object({ note: draftCellSchema(z.string()).default({}) });
  const work = { route: "timeline-proof", title: "Notes", description: "Timeline refusal", schema };
  const module = route({ key: work.route, name: "Notes", needs: "host", directory: reference.data.directory, fields: {},
    edits: { work, key: () => "one", owners: {}, input: z.never(), patches: () => [],
      history: z.object({ label: z.string() }), describe: (detail: { label: string }) => detail },
    panes: { main: { title: "Notes", purpose: "Restore refusal", body: "scroll", draw: () => scrollBody(<button>Focus route</button>) } },
    layout: { kind: "pane", id: "main" },
  });
  const door = createFixtureWorkDoor(work, schema.parse({}));
  const response = vi.fn(async () => Response.json({ ok: false, error: "Restore unavailable" }, { status: 503 }));
  const mount = mountTypedRoute(module, {
    address: { read: () => new URLSearchParams(), write: () => {}, subscribe: () => () => {} },
    fixture: null, target: { kind: "host" }, work: { address: null, open: null }, custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
    work: door, timeline: { ...door.timeline, step: createTimelineClient({ response }).step },
  });
  const root = createRootRoute({ component: () => <RouteControlsProvider><BandOutlet /><TypedChrome mount={mount} document={null} /></RouteControlsProvider> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [module.data.address] }) });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  try {
    await waitFor(() => expect(mount.owner()?.ready).toBe(true));
    await act(async () => { expect(await mount.draw("main", ctx => ctx.cells.at(["note"]).stage("new", { label: "Edit note" }))).toBeNull(); });
    await screen.findByRole("button", { name: "Undo Edit note" });
    const focus = screen.getByRole("button", { name: "Focus route" });
    focus.focus();
    fireEvent.keyDown(focus, { key: "z", code: "KeyZ", ctrlKey: true });
    await waitFor(() => expect(response).toHaveBeenCalledWith("work.history", expect.anything()));
    const outcome = await screen.findByRole("alert");
    expect(outcome.textContent).toContain("Restore unavailable");
    expect(outcome.closest('[data-slot="button-host"]')?.querySelector("button")?.getAttribute("aria-label")).toBe("Undo Edit note");
    fireEvent.click(await screen.findByRole("button", { name: "Undo Edit note" }));
    await waitFor(() => expect(response).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(schema.parse(mount.work()?.value).note.edit?.value).toBe("new");
  } finally { view.unmount(); mount.dispose(); }
});
