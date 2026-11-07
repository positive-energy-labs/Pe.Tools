// @vitest-environment jsdom
import { journey as takeoffJourney, Drawing as TakeoffDrawing } from "../takeoff/adoption.test.fixture";
import { adoptionData } from "@pe/agent-contracts/takeoff-read";
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

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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


test("JZ H01 H17 saved takeoff choice preserves authored Work and live Initialize while History captures", async () => {
  const j = await takeoffJourney();
  try {
    await j.ready();
    expect((await j.host.journal.list()).some(row => row.key === "work.start" && row.state === "succeeded"), "ordinary Start crossed the real /actions handler").toBe(true);
    const originalWork = j.mount.owner()!.handle;
    expect(originalWork).toBeTruthy();
    render(<TakeoffDrawing mount={j.mount} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose views" }));
    fireEvent.click(await screen.findByRole("option", { name: "Zoning plan" }));
    await waitFor(() => expect(j.mount.value().current).toBe(true), {timeout:20000});
    await waitFor(() => expect(j.mount.owner()?.ready || j.mount.owner()?.absent).toBe(true));
    expect(j.mount.owner()!.handle, "H01: view choice cannot select another Work through serialized Page fields").toEqual(originalWork);
    await j.ready();
    const capture = adoptionData.parse(j.mount.value().value).captures[0]!;
    fireEvent.click(screen.getByRole("button", { name: "Choose capture" }));
    const option = (await screen.findAllByRole("option")).find(row => row.textContent?.includes(capture.capturedAt));
    expect(option, "choose this exact saved capture").toBeTruthy();
    fireEvent.click(option!);
    await waitFor(() => expect(j.mount.value().current).toBe(true), {timeout:20000});
    await waitFor(() => expect(j.mount.owner()?.ready || j.mount.owner()?.absent).toBe(true));
    expect(screen.getByText(/Archived takeoff/)).toBeTruthy();
    expect(j.mount.owner()!.handle, "H01: a saved-evidence id cannot select another Work").toEqual(originalWork);
    expect(j.host.inputs.source).toMatchObject({capturing:true});
    fireEvent.click(screen.getByRole("button", {name:"live"}));
    await j.ready();
    await screen.findByRole("checkbox", {name:"Select Office zone in Zoning plan"});
    expect(j.mount.owner()!.handle).toEqual(originalWork);
    expect((screen.getByRole("button", {name:"initialize"}) as HTMLButtonElement).disabled, "H17: live readiness uses the current document and its original Work").toBe(false);
    expect(j.mount.value().value.initialize.refusal).toBeNull();
    expect(j.host.inputs.source).toMatchObject({capturing:true});
    expect(j.host.inputs.lane.kind).toBe("live");
    if(j.host.inputs.lane.kind === "live")
      expect(j.host.inputs.lane.captureStore!.capture.truncated(), "zero capture stops").toBeNull();
  } finally { await j.close(); }
}, 60000);
