// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { KeyScopeHost } from "@pe/kit/keys";
import { familiesRouteState, address, workFingerprintSchema, type WorkJournalDoor } from "@pe/agent-contracts";
import { module as families } from "../families/route";
import { TypedChrome } from "./typed-shell";
import * as mounts from "./typed-mount";
import { createFixtureWorkDoor } from "./fixture-work-door";
import type { UseSource } from "./source-contract";

afterEach(cleanup);

/** A failed Work read is damage on the pane it starves (I2, 2026-11-11 caution): the core pane
 *  draws the kit failure line, and the Situation band no longer carries the raw error sentence. */
test("a failed Work read draws one caution failure line in the core pane, not a sentence in the band", async () => {
  const message = "Error: Resource value exceeds the frame limit or cannot be serialized.";
  const doc = familiesRouteState.schema.parse({});
  const fixture = createFixtureWorkDoor(familiesRouteState, doc);
  const work: WorkJournalDoor = {
    ...fixture,
    open: () => ({
      subscribe(deliver, end) {
        deliver({ kind: "failed", failure: { kind: "failed", code: "WorkReadFailed", message } });
        end();
        return () => {};
      },
    }),
  };
  const source: UseSource = { kind: "use", open() { return () => {}; } };
  const mount = mounts.mountTypedRoute(families, {
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    fixture: null, target: { kind: "document", ref: { session: "s", openId: "project" } },
    work: { address: address("C:/Models/Frame-Limit.rvt"), open: null }, custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { work, sources: { "families.view": source } });
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return <KeyScopeHost id="failure-line"><TypedChrome mount={mount} document={<span>Frame limit</span>} /></KeyScopeHost>;
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/families"] }) });
  const view = render(<RouterProvider router={router} />);
  try {
    await waitFor(() => expect(mount.failure()).toContain("frame limit"));
    const line = await screen.findByText("Reading failed");
    expect(line.closest("[data-slot='pane']"), "the failure line sits in a pane").not.toBeNull();
    // The route's declared ground reaches the kit Pane through the slot API (design ledger default 6).
    expect(line.closest("[data-slot='pane']")!.getAttribute("data-surface")).toBe("artifact");
    expect(within(line.closest("[data-slot='pane']") as HTMLElement).getByText(/frame limit/)).toBeTruthy();
    const outside = screen.queryAllByRole("alert").filter((el) => /frame limit/.test(el.textContent ?? "") && !el.closest("[data-slot='pane']"));
    expect(outside, "no band alert sentence outside the panes").toEqual([]);
  } finally { view.unmount(); mount.dispose(); }
}, 30_000);
