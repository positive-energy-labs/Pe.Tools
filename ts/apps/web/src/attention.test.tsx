// @vitest-environment jsdom
import * as Atom from "effect/unstable/reactivity/Atom";
import { RegistryContext } from "@effect/atom-react";
import { Profiler } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { writeFileSync } from "node:fs";
import {
  attention,
  citation,
  cite,
  clearCitation,
  elementKey,
  members,
  rung,
  selection,
  setHovered,
  type SubjectKey,
} from "@pe/kit/lang/attention";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { SubjectText } from "@pe/kit/lang/subject-text";
import { Row } from "@pe/kit/lang/row";
import { makeAtomRegistry, createRouteOwner } from "#/route/route-owner";
import { createViewOwner } from "#/route/view-owner";
import { inspectAtomRegistry } from "#/state/atom-inspect";
import { AttentionScope, AttentionRoot, useElementAttention, useHoveredIssue } from "#/attention";
import { Annotations } from "#/ducts/annotations";
import { DEMO_ROOMS, DEMO_PLAN, DEMO_VIEW } from "#/rooms/demo";
import { manifest } from "#/rooms/manifest";
import { RoomsPlan } from "#/rooms/plan";
import { RoomsTable, roomRows } from "#/rooms/table";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
vi.mock("@pe/kit/lib/token", () => ({
  token: () => "currentColor",
  tokenRef: () => "currentColor",
  dash: () => "none",
}));

it("expands runs and issues, isolates documents, reads Page selection and dedupes string rungs", () => {
  const registry = makeAtomRegistry();
  const page = Atom.make({ selected: [] as string[] });
  const selected = Atom.make((get) => new Set<SubjectKey>(get(page).selected.map(elementKey)));
  registry.set(selection("doc"), selected);
  registry.set(members("doc"), {
    resolve: (key) => (key === "run:7" || key === "issue:gap" ? ["e:1", "e:2"] : [key]),
  });
  const one = rung({ doc: "doc", key: "e:1" });
  const untouched = rung({ doc: "doc", key: "e:99" });
  expect(one).toBe(rung({ doc: "doc", key: "e:1" }));
  const changes = vi.fn();
  const none = vi.fn();
  const stop = [registry.subscribe(one, changes), registry.subscribe(untouched, none)];
  registry.get(one);
  registry.get(untouched);
  changes.mockClear();
  none.mockClear();
  setHovered(registry, { doc: "other", key: "e:1" });
  expect(registry.get(one)).toBe("rest");
  setHovered(registry, { doc: "doc", key: "run:7" });
  expect(registry.get(attention("doc")).hovered).toEqual(new Set(["e:1", "e:2"]));
  for (let i = 0; i < 30; i++) setHovered(registry, { doc: "doc", key: "issue:gap" });
  expect(registry.get(one)).toBe("hover");
  expect(changes).toHaveBeenCalledTimes(1);
  expect(none).not.toHaveBeenCalled();
  cite(registry, {
    owner: "chat",
    refs: [{ doc: "doc", key: "e:1", name: "duct", number: 1 }],
    focus: { doc: "doc", key: "e:1" },
  });
  expect(registry.get(one)).toBe("focus");
  registry.set(page, { selected: ["1"] });
  expect(registry.get(one)).toBe("selected");
  clearCitation(registry, "previous-owner");
  expect(registry.get(citation)?.owner).toBe("chat");
  expect(
    inspectAtomRegistry(registry)
      .inspect()
      .nodes.some((node) => node.label === "attention/hovered"),
  ).toBe(true);
  stop.forEach((stop) => stop());
  registry.dispose();
});

it("measures 30 subject transitions and repeated pointer motion over 100 actual kit rows", async () => {
  const registry = makeAtomRegistry();
  const selected = Atom.make<ReadonlySet<SubjectKey>>(new Set<SubjectKey>());
  let rows = 0,
    picture = 0,
    screen = 0,
    inbox = 0;
  function Inbox() {
    useHoveredIssue();
    inbox++;
    return null;
  }
  function Picture() {
    useElementAttention();
    picture++;
    return null;
  }
  function Screen() {
    screen++;
    return (
      <AttentionScope doc="measure" selected={selected}>
        <SubjectTextContext value={{ doc: "measure", nameOf: String }}>
          {Array.from({ length: 100 }, (_, i) => (
            <Profiler key={i} id={String(i)} onRender={() => rows++}>
              <Row label={`subject ${i}`} revit={[i]} />
            </Profiler>
          ))}
          <Picture />
          <Inbox />
        </SubjectTextContext>
      </AttentionScope>
    );
  }
  const view = render(
    <RegistryContext value={registry}>
      <Screen />
    </RegistryContext>,
  );
  rows = picture = screen = inbox = 0;
  for (let i = 0; i < 30; i++) {
    const row = view.getByText(`subject ${i}`).closest(".dl-row")!;
    fireEvent.pointerOver(row);
    fireEvent.mouseEnter(row);
  }
  const transitions = { transitions: 30, rows, picture, screen };
  expect(transitions).toEqual({ transitions: 30, rows: 0, picture: 30, screen: 0 });
  expect(inbox).toBe(0);
  rows = picture = screen = 0;
  const last = view.getByText("subject 29").closest(".dl-row")!;
  for (let i = 0; i < 30; i++) {
    fireEvent.pointerMove(last);
    fireEvent.pointerOver(last);
  }
  expect({ rows, picture, screen }).toEqual({ rows: 0, picture: 0, screen: 0 });
  writeFileSync(
    "../../../.artifacts/runs/deterministic-20261024-attention/after.json",
    JSON.stringify({ transitions, repeatedMoves: { moves: 30, rows, picture, screen } }),
  );
  view.unmount();
  registry.dispose();
});

it("the native picture adapter lights every member of a run and nested room group", () => {
  const registry = makeAtomRegistry();
  const selected = Atom.make<ReadonlySet<SubjectKey>>(new Set<SubjectKey>());
  const resolve = (key: SubjectKey): SubjectKey[] =>
    key === "run:7"
      ? ["e:1", "e:2"]
      : key === "room:guid"
        ? ["e:3"]
        : key.startsWith("leg:[")
          ? ["run:7", "room:guid"]
          : [key];
  function Picture() {
    const state = useElementAttention();
    return <output>{[...state.lit].join(",")}</output>;
  }
  const view = render(
    <RegistryContext value={registry}>
      <AttentionScope doc="group-doc" selected={selected} members={resolve}>
        <Picture />
      </AttentionScope>
    </RegistryContext>,
  );
  act(() => setHovered(registry, { doc: "group-doc", key: "run:7" }));
  expect(view.container.querySelector("output")?.textContent).toBe("1,2");
  act(() => setHovered(registry, { doc: "group-doc", key: 'leg:["run:7","room:guid"]' }));
  expect(view.container.querySelector("output")?.textContent).toBe("1,2,3");
  view.unmount();
  registry.dispose();
});

it("SubjectText in another React root lights the ducts picture set and projected footnotes through one registry", () => {
  const registry = makeAtomRegistry();
  const selected = Atom.make<ReadonlySet<SubjectKey>>(new Set<SubjectKey>());
  function Picture() {
    const state = useElementAttention();
    return (
      <>
        <output data-testid="set">{[...state.lit].join(",")}</output>
        <Annotations
          project={(p) => [p[0]!, p[1]!]}
          size={{ width: 400, height: 300 }}
          scene={
            {
              segments: [],
              nodes: [{ node: { id: 42, point: [50, 50, 0] }, issues: [] }],
              subject: null,
            } as never
          }
          layers={new Set()}
          encoding={{ bins: [], bin: () => 0 } as never}
          selected={new Set()}
          hovered={null}
          labels={[]}
          meshed={new Set([42])}
          rulings={[]}
          pointOf={(id) => (id === 42 ? [50, 50, 0] : null)}
          issue=""
          onPick={() => {}}
          onFrame={() => {}}
          onRuling={() => {}}
        />
      </>
    );
  }
  const picture = render(
    <RegistryContext value={registry}>
      <AttentionScope doc="same-doc" selected={selected}>
        <Picture />
      </AttentionScope>
    </RegistryContext>,
  );
  const prose = render(
    <RegistryContext value={registry}>
      <AttentionRoot doc="same-doc">
        <SubjectTextContext value={{ doc: "same-doc", nameOf: () => "outside duct" }}>
          <SubjectText text={[{ id: 42 }]} owner="outside" />
        </SubjectTextContext>
      </AttentionRoot>
    </RegistryContext>,
  );
  fireEvent.mouseEnter(prose.container.querySelector("[data-subject-text]")!);
  expect(picture.getByTestId("set").textContent).toBe("42");
  expect(picture.container.querySelector('[data-subject-badge="e:42"]')).toBeTruthy();
  const badge = picture.container.querySelector(".subject-badge")!;
  fireEvent.mouseEnter(badge);
  expect(registry.get(citation)?.focus).toEqual({ doc: "same-doc", key: "e:42" });
  act(() =>
    cite(registry, {
      owner: "other-doc",
      refs: [{ doc: "different-doc", key: "e:42", name: "different duct", number: 1 }],
      focus: null,
    }),
  );
  expect(picture.getByTestId("set").textContent).toBe("");
  expect(picture.container.querySelector("[data-subject-badge]")).toBeNull();
  prose.unmount();
  picture.unmount();
  registry.dispose();
});

it("rooms table and plan light each other by GUID while clicks and URL/Page selection stay with the route", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private read: ResizeObserverCallback) {}
      observe() {
        this.read(
          [{ contentRect: { width: 800, height: 600 } }] as ResizeObserverEntry[],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
      unobserve() {}
    },
  );
  const registry = makeAtomRegistry();
  const owner = createRouteOwner("rooms-attention-test", registry);
  const pageOwner = createViewOwner(owner, manifest.page, { view: DEMO_VIEW });
  const selected = Atom.make(
    (get) =>
      new Set<SubjectKey>(
        get(pageOwner.state).page.selected.map((guid): SubjectKey => `room:${guid}`),
      ),
  );
  const rows = roomRows(DEMO_ROOMS.regions, ["Fixture level"]);
  const members = (key: SubjectKey): SubjectKey[] => {
    const region = DEMO_ROOMS.regions.find((region) => `room:${region.guid}` === key);
    return region ? [elementKey(region.elementId)] : [key];
  };
  const select = vi.fn((guids: ReadonlySet<string>) => pageOwner.setPage({ selected: [...guids] }));
  const view = render(
    <RegistryContext value={registry}>
      <AttentionScope doc="rooms-fixture" selected={selected} members={members}>
        <RoomsTable
          rows={rows}
          cells={{}}
          wire={{ segment: "edits", revision: 0, write: vi.fn() } as never}
          onSelect={select}
          empty={{ says: "empty", exit: "none" }}
        />
        <RoomsPlan
          rows={rows}
          plan={DEMO_PLAN}
          planError={null}
          planRefusal={null}
          empty={null}
          zoomTo={[]}
          focusMissing={[]}
          onSelect={(guid) => guid && select(new Set([guid]))}
          trace={{ data: null, none: "fixture" }}
          page={registry.get(pageOwner.state).page}
          setPage={pageOwner.setPage}
        />
      </AttentionScope>
    </RegistryContext>,
  );
  const row = view.container.querySelector('tr[data-subject="room:fixture-1"]')!;
  const path = view.container.querySelector('path[data-subject="room:fixture-1"]')!;
  expect(row).toBeTruthy();
  expect(path).toBeTruthy();
  fireEvent.pointerOver(row);
  expect(path.getAttribute("data-reach")).toBe("hover");
  fireEvent.pointerOver(path);
  expect(row.getAttribute("data-reach")).toBe("hover");
  fireEvent.click(path);
  expect(select).toHaveBeenCalledOnce();
  expect(registry.get(pageOwner.state).page.selected).toEqual(["fixture-1"]);
  await waitFor(() => expect(row.getAttribute("data-reach")).toBe("selected"));
  act(() => pageOwner.setPage({ selected: [] }));
  expect(row.getAttribute("data-reach")).toBe("hover");
  view.unmount();
  pageOwner.dispose();
  owner.dispose();
  registry.dispose();
});
