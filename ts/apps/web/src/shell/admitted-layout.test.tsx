// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { AdmittedPane } from "./admitted-place.test-fixture";
afterEach(cleanup);
test("declared split and predicate gates render over one mount", () => {
  let shown = true,
    revision = 0;
  const listeners = new Set<() => void>();
  const close = vi.fn();
  const mount = {
    page: { read: () => ({ subject: null }) },
    release: vi.fn(),
    setPaneDemand: vi.fn(),
    dispose: close,
    recovery: () => ({}),
    workFailure: () => null,
    workProblem: () => null,
    subjectDisplay: () => null,
    picker: () => [],
    work: () => null,
    restoreWork: vi.fn(),
    journalRefusal: () => null,
    journal: () => null,
    timeline: () => [],
    activity: () => [],
    refusedEdits: () => [],
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    revision: () => revision,
    visible: (id: string) => id === "picture" || shown,
    predicates: () => ({ facts: shown }),
    read: (id: string) => createElement("p", null, id),
    close,
    commandProblems: () => [],
    reviewIds: () => [],
  };
  const shell = { mount: vi.fn(() => mount) };
  const route = {
    data: {
      key: "layout",
      address: "/layout",
      name: "Layout",
      subject: { field: "subject", noun: "subjects", pane: "picture" },
      fields: { subject: { role: "subject", cardinality: "one" } },
      stageOrder: ["view"],
      stages: { view: { word: "View", panes: ["picture", "facts"], verbs: [] } },
      verbs: {},
      panes: {
        picture: { label: "Picture", purpose: "Read picture", draws: [], verbs: [] },
        facts: { label: "Facts", purpose: "Read facts", draws: [], verbs: [] },
      },
      layout: {
        kind: "split",
        id: "witness-split",
        axis: "h",
        size: 280,
        children: [
          { kind: "pane", id: "picture" },
          { kind: "gate", when: "facts", child: { kind: "pane", id: "facts" } },
        ],
      },
    },
  };
  const { container, unmount } = render(
    createElement(AdmittedPane, {
      shell,
      route,
      address: { read: () => new URLSearchParams(), subscribe: () => () => {}, write: vi.fn() },
    } as any),
  );
  expect(screen.getByText("picture")).toBeTruthy();
  expect(screen.getByText("facts")).toBeTruthy();
  const split = container.querySelector("[data-layout-split]")!;
  expect(split.getAttribute("data-axis")).toBe("horizontal");
  expect(split.getAttribute("data-pane-target")).toBe("end");
  expect(split.getAttribute("style")).toContain("280px");
  act(() => {
    shown = false;
    revision++;
    listeners.forEach((f) => f());
  });
  expect(screen.queryByText("facts")).toBeNull();
  expect(screen.getByText("picture")).toBeTruthy();
  act(() => {
    shown = true;
    revision++;
    listeners.forEach((f) => f());
  });
  expect(screen.getByText("facts")).toBeTruthy();
  expect(shell.mount).toHaveBeenCalledOnce();
  unmount();
  expect(mount.close).toHaveBeenCalledOnce();
});
