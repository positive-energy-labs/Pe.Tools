// @vitest-environment jsdom
import { beforeEach, afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  admittedJournalKeys,
  admittedSubjectDoor,
  routeHasSubjectList,
  PaneStatus,
  AdmittedSubjectPicker,
  subjectOf,
} from "./admitted-chrome";
import { ReviewSurface } from "./review-surface";
import { routeOwnsKey } from "./mount-work";
import type { AdmittedMount } from "./admitted-mount";
import { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("Work undo follows current focus through portals and preserves native text undo", () => {
  const restoreWork = vi.fn();
  const mine = document.createElement("section");
  mine.dataset.routeMount = "mine";
  mine.dataset.routeJournal = "";
  const theirs = document.createElement("section");
  theirs.dataset.routeMount = "theirs";
  theirs.dataset.routeJournal = "";
  const composer = document.createElement("button");
  const input = document.createElement("textarea");
  document.body.append(mine, theirs, composer, input);
  let primary = true,
    live = true;
  const keys = admittedJournalKeys(
    { restoreWork, journalRefusal: () => null } as unknown as AdmittedMount,
    () => live,
    (event) => routeOwnsKey(mine, primary, event),
  );
  const press = (node: HTMLElement, index: number) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    keys[index]!.callback(event, {} as never);
    return event;
  };
  expect(press(composer, 0).defaultPrevented).toBe(true);
  press(mine, 1);
  press(composer, 2);
  expect(restoreWork.mock.calls).toEqual([["undo"], ["redo"], ["redo"]]);
  expect(press(input, 0).defaultPrevented).toBe(false);
  press(theirs, 0);
  primary = false;
  press(composer, 0);
  live = false;
  press(mine, 0);
  expect(restoreWork).toHaveBeenCalledTimes(3);
  mine.remove();
  theirs.remove();
  composer.remove();
  input.remove();
});

test("many-subject all/none use the declared control and unknown membership never prints ids", () => {
  const subject = vi.fn();
  const mount = {
    picker: () => [{ id: "hidden-id", label: "Supply" }],
    page: { read: () => ({ system: { kind: "all" } }) },
    controls: { subject },
  } as unknown as AdmittedMount;
  const data = {
    subject: { field: "system", noun: "systems" },
    fields: { system: { role: "subject", cardinality: "many" } },
  } as unknown as RouteGraphJson;
  const ui = render(<AdmittedSubjectPicker mount={mount} data={data} />);
  expect(ui.container.textContent).toContain("All systems");
  expect(ui.container.textContent).not.toContain("hidden-id");
  fireEvent.click(screen.getByRole("button", { name: "No systems" }));
  fireEvent.click(screen.getByRole("button", { name: "All systems" }));
  expect(subject.mock.calls).toEqual([[{ kind: "ids", ids: [] }], [{ kind: "all" }]]);
});

test("review uses a portal, friendly labels and a footer outside long content; Escape cancels", async () => {
  const cancel = vi.fn(),
    confirm = vi.fn();
  const anchor = document.createElement("button");
  document.body.append(anchor);
  anchor.focus();
  const ui = render(
    <ReviewSurface
      label="Update airflows"
      sentence="Change Supply"
      rows={Array.from({ length: 200 }, (_, i) => `Change ${i}`)}
      enabled
      confirm={confirm}
      cancel={cancel}
    />,
  );
  const commit = await screen.findByRole("button", { name: "Commit Update airflows" });
  expect(ui.container.contains(commit)).toBe(false);
  expect(commit.closest(".shrink-0")?.className).toContain("shrink-0");
  expect(commit.closest(".shrink-0")?.previousElementSibling?.className).toContain(
    "overflow-y-auto",
  );
  expect(document.body.textContent).not.toContain("Commit apply");
  fireEvent.click(commit);
  expect(confirm).toHaveBeenCalledOnce();
  fireEvent.keyDown(document.activeElement ?? commit, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  anchor.remove();
});

test("admitted declarations preserve pane frames and split bounds for kit projection", () => {
  const node = RouteGraphJson.shape.layout.parse({
    kind: "split",
    id: "bounded",
    axis: "h",
    sized: "start",
    size: 280,
    minSize: 160,
    maxSize: 480,
    minOtherSize: 200,
    persist: "device",
    rails: { start: { title: "Systems", collapseBelow: 120 } },
    children: [
      { kind: "pane", id: "main" },
      { kind: "pane", id: "aside" },
    ],
  });
  expect(node).toMatchObject({
    minSize: 160,
    maxSize: 480,
    sized: "start",
    rails: { start: { title: "Systems" } },
  });
  expect(
    RouteGraphJson.shape.panes.parse({
      main: {
        label: "Main",
        purpose: "Read",
        draws: [],
        verbs: [],
        body: "main",
        frame: { scroll: "clip", picture: true },
      },
    }).main?.frame,
  ).toEqual({ scroll: "clip", picture: true });
  expect(RouteGraphJson.shape.layout.safeParse({ ...node, minSize: -1 }).success).toBe(false);
});

test("the subject door adds beside what is open, and never narrows all to explicit ids", () => {
  const subject = vi.fn();
  let value: unknown = { kind: "all" };
  const mount = {
    picker: () => [
      { id: "a", label: "SA 1" },
      { id: "b", label: "SA 2" },
    ],
    page: { read: () => ({ system: value }) },
    controls: { subject },
  } as unknown as AdmittedMount;
  const data = {
    subject: { field: "system", noun: "systems" },
    fields: { system: { role: "subject", cardinality: "many" } },
  } as unknown as RouteGraphJson;
  subjectOf(mount, data)!.add(["b"]);
  expect(subject).not.toHaveBeenCalled();
  value = { kind: "ids", ids: ["a"] };
  subjectOf(mount, data)!.add(["a", "b"]);
  subjectOf(mount, data)!.toggle("a");
  expect(subject.mock.calls).toEqual([
    [{ kind: "ids", ids: ["a", "b"] }],
    [{ kind: "ids", ids: [] }],
  ]);
});

 test("all and clear each send one generated subject transition, without enumerating the roster", () => {
  const subject = vi.fn();
  const mount = { controls: { subject } } as unknown as AdmittedMount;
  const data = { subject: { field: "system" }, fields: { system: { role: "subject", cardinality: "many" } } } as unknown as RouteGraphJson;
  const door = admittedSubjectDoor(mount, data);
  door.all();
  expect(subject.mock.calls).toEqual([[{ kind: "all" }]]);
  subject.mockClear();
  door.clear();
  expect(subject.mock.calls).toEqual([[{ kind: "ids", ids: [] }]]);
 });

test("a route with a subject-list pane suppresses chrome's picker even on another pane", () => {
  const data = { subject: { field: "system", pane: "detail" }, fields: { system: { role: "subject", picker: { reading: "roster" } } }, panes: { list: { draws: ["roster"] }, detail: { draws: ["detail"] } } } as unknown as RouteGraphJson;
  expect(routeHasSubjectList(data)).toBe(true);
});

test("a route without a subject-list pane keeps chrome's picker", () => {
  const data = { subject: { field: "system", pane: "detail" }, fields: { system: { role: "subject", picker: { reading: "roster" } } }, panes: { detail: { draws: ["detail"] } } } as unknown as RouteGraphJson;
  expect(routeHasSubjectList(data)).toBe(false);
});

test("idle explicit readings draw no explanation while real failures remain visible", () => {
  let reason = "Explicit demand required";
  const mount = { readingStatus: () => ({ snapshot: { status: "unavailable", current: false, reason } }) } as unknown as AdmittedMount;
  const view = render(<PaneStatus mount={mount} draws={["detail"]} />);
  expect(view.container.textContent).toBe("");
  reason = "Document closed";
  view.rerender(<PaneStatus mount={mount} draws={["detail"]} />);
  expect(screen.getByRole("status").textContent).toBe("Document closed");
});
