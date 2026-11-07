// @vitest-environment jsdom
import { useState } from "react";
import { createPortal } from "react-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { route } from "./typed-route";
import { module as fans } from "../fans/route";
import { TypedShell } from "../shell/typed-shell";
import * as mounts from "../shell/typed-mount";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { ReviewSurface } from "../shell/review-surface";
import { RouteVisibility } from "./activity";
import { module as family } from "../family/route";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("JM H17 browse an optional host route without a pin, then refuse malformed document pins", async () => {
  const module = route({ ...family.spec, edits: undefined, core: undefined, commands: {}, reads: {},
    panes: { main: { title: "Optional document", purpose: "Inspect exact target authority",
      draw: ctx => <p role="status">{ctx.target?.kind === "host" ? "Host browsing" : "Pinned document"}</p> } },
    layout: { kind: "pane", id: "main" } });
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  let search = new URLSearchParams();
  const listeners = new Set<() => void>();
  const address = { read: () => new URLSearchParams(search), write(next: URLSearchParams) { search = next; listeners.forEach(f => f()); },
    subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; } };
  const root = createRootRoute({ component: () => <TypedShell module={module} fingerprint={stamp} address={address} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByText("Host browsing");
  address.write(new URLSearchParams({ target: "not JSON" }));
  await waitFor(() => expect(screen.queryByText("Host browsing"), "H17: a bad pin never falls back to host authority").toBeNull());
  expect(screen.queryByText("Pinned document"), "H17: unresolved pin grants no document authority").toBeNull();
});

test("JZ B04 read a long review, dismiss with Escape and return to its opener", async () => {
  function Journey() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Review airflows</button>{open && <ReviewSurface
      label="Update airflows" sentence="Change Supply" rows={Array.from({ length: 200 }, (_, i) => `Change ${i}`)}
      enabled confirm={() => { throw Error("Escape must not commit"); }} cancel={() => setOpen(false)} />}</>;
  }
  const view = render(<Journey />);
  const opener = screen.getByRole("button", { name: "Review airflows" });
  opener.focus();
  fireEvent.click(opener);
  const commit = await screen.findByRole("button", { name: "Commit Update airflows" });
  expect(view.container.contains(commit), "B04: review is portalled").toBe(false);
  expect(screen.getByText("Change 199"), "B04: final change is present").toBeTruthy();
  commit.focus();
  expect(document.activeElement).toBe(commit);
  fireEvent.keyDown(commit, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Commit Update airflows" })).toBeNull());
  await waitFor(() => expect(document.activeElement, "B04: dismissal restores prior focus").toBe(opener));
  // Scroll reach and footer visibility require Driver layout evidence; jsdom cannot establish either.
});

test("JZ B02 undo follows focus between typed routes, portal and hidden pane; text keeps native undo", async () => {
  const live = mounts.mountTypedRoute;
  const owners: mounts.TypedMount[] = [];
  vi.spyOn(mounts, "mountTypedRoute").mockImplementation((...args) => {
    const owner = live(...args); owners.push(owner); return owner;
  });
  const make = (key: string) => route({ ...fans.spec, key, name: key, needs: "browser", core: undefined,
    subject: undefined, reads: {}, edits: undefined, commands: {}, fields: {},
    panes: { main: { title: key, purpose: "Focus ownership", draw: () => <><button>{key} focus</button><textarea aria-label={`${key} text`} />{createPortal(<button>{key} portal</button>, document.body)}</> } },
    layout: { kind: "pane", id: "main" } });
  const a = make("jz-a"), b = make("jz-b");
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const address = () => ({ read: () => new URLSearchParams(), write: () => {}, subscribe: () => () => {} });
  const addressA = address(), addressB = address();
  function Journey() {
    const [hidden, setHidden] = useState(false);
    return <><button onClick={() => setHidden(true)}>Hide B</button><TypedShell module={a} fingerprint={stamp} address={addressA} />
      <RouteVisibility.Provider value={!hidden}><div hidden={hidden}><TypedShell module={b} fingerprint={stamp} address={addressB} /></div></RouteVisibility.Provider></>;
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "jz-b focus" });
  expect(owners).toHaveLength(2);
  const undo = owners.map(owner => vi.spyOn(owner.history, "undo"));
  const press = (node: HTMLElement) => { node.focus(); const native = fireEvent.keyDown(node, { key: "z", code: "KeyZ", ctrlKey: true }); fireEvent.keyUp(node, { key: "z", code: "KeyZ", ctrlKey: true }); return native; };
  press(screen.getByRole("textbox", { name: "jz-a text" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: browser retains text undo").toEqual([0, 0]);
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: only the focused route receives undo").toEqual([1, 0]);
  press(screen.getByRole("button", { name: "jz-b portal" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: portal belongs to B").toEqual([1, 1]);
  fireEvent.click(screen.getByRole("button", { name: "Hide B" }));
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: hidden B cannot steal undo").toEqual([2, 1]);
});
