// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { ActionButton } from "#/components/lang/action-button";
import { Pane, PaneSplit, PaneWorkspace } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("pane focus owns its hotkeys, halo, and fading shortcut card", async () => {
  vi.useFakeTimers();
  const run = vi.fn();
  const { container } = render(
    <Pane
      id="rooms"
      kind="content"
      shortcuts={[{ hotkey: "J", label: "next room", callback: run }]}
    >
      <button type="button">Room row</button>
      <input aria-label="Room name" />
    </Pane>,
  );

  act(() => screen.getByRole("button", { name: "Room row" }).focus());
  const pane = container.querySelector<HTMLElement>("[data-slot='pane']")!;
  expect(pane.dataset.active).toBe("true");
  expect(pane.style.outline).toBe("2px solid var(--pe-ink-mute)");
  expect(pane.style.outlineOffset).toBe("2px");
  expect(pane.classList.contains("z-sticky")).toBe(true);
  expect(screen.getByLabelText("rooms keyboard shortcuts").dataset.visible).toBe("true");

  fireEvent.keyDown(screen.getByRole("button", { name: "Room row" }), {
    key: "j",
    code: "KeyJ",
  });
  expect(run).toHaveBeenCalledOnce();

  act(() => screen.getByRole("textbox", { name: "Room name" }).focus());
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Room name" }), {
    key: "j",
    code: "KeyJ",
  });
  expect(run).toHaveBeenCalledOnce();

  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(pane.style.outline).toBe("1px solid var(--pe-line-2)");
  expect(screen.getByLabelText("rooms keyboard shortcuts").dataset.visible).toBe("false");
  expect(screen.getByRole("button", { name: "Show rooms keyboard shortcuts" })).toBeTruthy();
});

test("the nearest nested pane owns a conflicting shortcut", () => {
  const outer = vi.fn();
  const inner = vi.fn();
  const { container } = render(
    <Pane
      id="rooms"
      kind="content"
      shortcuts={[{ hotkey: "J", label: "next room", callback: outer }]}
    >
      <Pane
        id="room"
        kind="inspector"
        shortcuts={[{ hotkey: "J", label: "next room", callback: inner }]}
      >
        <button type="button">Room detail</button>
      </Pane>
    </Pane>,
  );

  act(() => screen.getByRole("button", { name: "Room detail" }).focus());
  fireEvent.keyDown(screen.getByRole("button", { name: "Room detail" }), {
    key: "j",
    code: "KeyJ",
  });

  expect(inner).toHaveBeenCalledOnce();
  expect(outer).not.toHaveBeenCalled();
  expect(container.querySelector("[data-pane-id='rooms']")?.getAttribute("data-active")).toBe(
    "false",
  );
  expect(container.querySelector("[data-pane-id='room']")?.getAttribute("data-active")).toBe(
    "true",
  );
});

test("the shortcut card mutes disabled rows", () => {
  render(
    <Pane
      id="rooms"
      kind="content"
      shortcuts={[
        {
          hotkey: "A",
          label: "disabled action",
          callback: () => undefined,
          options: { enabled: false },
        },
        {
          hotkey: "D",
          label: "enabled action",
          callback: () => undefined,
          options: { enabled: true },
        },
      ]}
    >
      <button type="button">Room row</button>
    </Pane>,
  );

  act(() => screen.getByRole("button", { name: "Room row" }).focus());
  const disabled = screen.getByText("disabled action").closest("[data-slot='pane-shortcut']");
  const enabled = screen.getByText("enabled action").closest("[data-slot='pane-shortcut']");

  expect(disabled?.getAttribute("data-enabled")).toBe("false");
  expect(disabled?.classList.contains("text-ink-mute")).toBe(true);
  expect(enabled?.getAttribute("data-enabled")).toBe("true");
  expect(enabled?.classList.contains("text-ink-mute")).toBe(false);
});

test("the actions slot renders caller JSX in the header", () => {
  let selected = "";
  render(
    <Pane
      kind="inspector"
      title="selection"
      actions={
        <button type="button" onClick={() => (selected = "export")}>
          Export
        </button>
      }
    >
      body
    </Pane>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  expect(selected).toBe("export");
});

test("workspace resize is opt-in and keyboard accessible", () => {
  const { container } = render(
    <PaneWorkspace
      visual={<div>plan</div>}
      content={<div>table</div>}
      resize={{ visual: { defaultSize: 340, minSize: 140, maxSize: 720 } }}
    />,
  );
  const workspace = container.querySelector<HTMLElement>("[data-slot='pane-workspace']")!;

  expect(workspace.style.gridTemplateRows).toBe("340px var(--gutter) minmax(0, 1fr)");
  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize pane" }), {
    key: "ArrowDown",
  });
  expect(workspace.style.gridTemplateRows).toBe("356px var(--gutter) minmax(0, 1fr)");
});

test("split panes reserve a gutter and keep keyboard resizing", () => {
  const { container } = render(
    <PaneSplit
      axis="horizontal"
      start={<Pane kind="content">left</Pane>}
      end={<Pane kind="content">right</Pane>}
    />,
  );
  const split = container.querySelector<HTMLElement>("[data-slot='pane-split']")!;

  expect(split.style.gridTemplateColumns).toBe("minmax(0, 1fr) var(--gutter) minmax(0, 1fr)");
  expect(split.querySelector("[role='separator']")).toBeNull();
  expect(split.classList.contains("overflow-hidden")).toBe(false);
  expect((split.children[0] as HTMLElement).style.gridColumn).toBe("1");
  expect((split.children[1] as HTMLElement).style.gridColumn).toBe("3");

  const vertical = render(
    <PaneSplit
      axis="vertical"
      start={<Pane kind="content">top</Pane>}
      end={<Pane kind="content">bottom</Pane>}
    />,
  );
  const verticalSplit = vertical.container.querySelector<HTMLElement>("[data-slot='pane-split']")!;
  expect((verticalSplit.children[0] as HTMLElement).style.gridRow).toBe("1");
  expect((verticalSplit.children[1] as HTMLElement).style.gridRow).toBe("3");

  const resizable = render(
    <PaneSplit
      axis="horizontal"
      start={<Pane kind="content">left</Pane>}
      end={<Pane kind="content">right</Pane>}
      resize={{ target: "start", defaultSize: 200, minSize: 120 }}
    />,
  );
  const handle = screen.getByRole("separator", { name: "Resize pane" });
  expect(handle.parentElement?.style.gridColumn).toBe("2");
  expect(handle.parentElement?.style.gridRow).toBe("1");
  expect(handle.parentElement?.classList.contains("size-full")).toBe(true);
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(
    resizable.container.querySelector<HTMLElement>("[data-slot='pane-split']")?.style
      .gridTemplateColumns,
  ).toBe("216px var(--gutter) minmax(0, 1fr)");
});

test("a null split side retains wrappers without a gutter or handle", () => {
  const view = render(
    <PaneSplit
      axis="horizontal"
      start={<Pane kind="content">composer</Pane>}
      end={null}
      resize={{ target: "end", defaultSize: 288, minSize: 240 }}
    />,
  );
  const split = view.container.querySelector<HTMLElement>("[data-slot='pane-split']")!;
  const wrappers = Array.from(split.children) as HTMLElement[];

  expect(wrappers).toHaveLength(2);
  expect(split.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
  expect(split.querySelector("[role='separator']")).toBeNull();
  expect(wrappers.map((wrapper) => wrapper.style.gridColumn)).toEqual(["1", "1"]);
  expect(wrappers[0]?.classList.contains("hidden")).toBe(false);
  expect(wrappers[1]?.classList.contains("hidden")).toBe(true);
  fireEvent.pointerDown(screen.getByText("composer"));
  expect(
    (screen.getByText("composer").closest("[data-slot='pane']") as HTMLElement | null)?.dataset
      .active,
  ).toBe("true");

  view.rerender(
    <PaneSplit
      axis="horizontal"
      start={null}
      end={<Pane kind="content">plugin</Pane>}
      resize={{ target: "end", defaultSize: 288, minSize: 240 }}
    />,
  );
  const next = Array.from(split.children) as HTMLElement[];
  expect(next).toEqual(wrappers);
  expect(split.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
  expect(next[0]?.classList.contains("hidden")).toBe(true);
  expect(next[1]?.classList.contains("hidden")).toBe(false);
  fireEvent.pointerDown(screen.getByText("plugin"));
  expect(
    (screen.getByText("plugin").closest("[data-slot='pane']") as HTMLElement | null)?.dataset
      .active,
  ).toBe("true");
  expect(screen.getByText("plugin")).toBeTruthy();
});

test("split sides bound panes and direct artifacts as flex columns", () => {
  const { container } = render(
    <PaneSplit
      axis="horizontal"
      start={<Pane kind="content">table pane</Pane>}
      end={
        <ArtifactFrame className="flex min-h-0 flex-1 flex-col" head="table">
          table artifact
        </ArtifactFrame>
      }
    />,
  );
  const split = container.querySelector<HTMLElement>("[data-slot='pane-split']")!;
  const [paneSide, artifactSide] = Array.from(split.children) as HTMLElement[];

  for (const side of [paneSide, artifactSide]) {
    expect(side.classList.contains("flex")).toBe(true);
    expect(side.classList.contains("flex-col")).toBe(true);
    expect(side.classList.contains("min-h-0")).toBe(true);
  }
  expect(paneSide.firstElementChild?.classList.contains("size-full")).toBe(true);
  expect(artifactSide.firstElementChild?.classList.contains("flex-1")).toBe(true);
});

test("surface fills its parent without fixing to the viewport and keeps a scrolling head", () => {
  const { container } = render(
    <Surface head={<div>head</div>}>
      <div>body</div>
    </Surface>,
  );
  const scroller = container.querySelector("main")!;
  const surface = container.querySelector<HTMLElement>("[data-slot='surface']")!;

  expect(scroller.classList.contains("size-full")).toBe(true);
  expect(scroller.classList.contains("overflow-y-auto")).toBe(true);
  expect(surface.classList.contains("fixed")).toBe(false);
  expect(surface.classList.contains("h-dvh")).toBe(false);
  expect(surface.classList.contains("size-full")).toBe(true);
  expect(surface.classList.contains("flex")).toBe(true);
  expect(surface.classList.contains("flex-col")).toBe(true);
  expect(surface.style.padding).toBe("var(--gutter)");
});

test("a missing persisted size starts at the declared default", () => {
  const { container } = render(
    <PaneWorkspace
      visual={<div>plan</div>}
      content={<div>table</div>}
      resize={{
        visual: {
          defaultSize: 374,
          minSize: 174,
          persist: "test.plan-height",
        },
      }}
    />,
  );
  const workspace = container.querySelector<HTMLElement>("[data-slot='pane-workspace']")!;

  expect(workspace.style.gridTemplateRows).toBe("374px var(--gutter) minmax(0, 1fr)");
});

test("controlled collapse and inspector span are reflected by the workspace", () => {
  const view = render(
    <PaneWorkspace
      visual={<div>plan</div>}
      content={<div>table</div>}
      inspector={<div>details</div>}
      inspectorSpan="visual"
      resize={{
        visual: {
          defaultSize: 340,
          minSize: 140,
          collapse: { collapsed: true, collapsedSize: 34 },
        },
      }}
    />,
  );
  const workspace = view.container.querySelector<HTMLElement>("[data-slot='pane-workspace']")!;

  expect(workspace.style.gridTemplateRows).toBe("34px var(--gutter) minmax(0, 1fr)");
  expect(workspace.dataset.inspectorSpan).toBe("visual");

  view.rerender(
    <PaneWorkspace
      visual={<div>plan</div>}
      content={<div>table</div>}
      inspector={<div>details</div>}
      inspectorSpan="full"
    />,
  );
  expect(workspace.dataset.inspectorSpan).toBe("full");
});

test("a pane header owns one rail and no halo node", () => {
  const { container } = render(
    <Pane kind="content" title="rooms">
      body
    </Pane>,
  );

  expect(container.querySelector("[data-slot='pane-header'] [data-slot='rail']")).toBeTruthy();
  expect(container.querySelector("[data-slot='pane-halo']")).toBeNull();
});

test("pane headers default on and require an explicit headerless opt-out", () => {
  const view = render(<Pane kind="content">body</Pane>);
  expect(view.container.querySelector("[data-slot='pane-header'] [data-slot='rail']")).toBeTruthy();

  view.rerender(
    <Pane kind="content" title="room table" headerless>
      body
    </Pane>,
  );
  expect(view.container.querySelector("[data-slot='pane-header']")).toBeNull();
  expect(screen.getByRole("region", { name: "room table" })).toBeTruthy();
});

test("workspace gutters appear only beside present outer panes and do not clip pane outlines", () => {
  const { container, rerender } = render(
    <PaneWorkspace
      visual={<Pane kind="visual">plan</Pane>}
      content={<Pane kind="content">table</Pane>}
    />,
  );
  const workspace = container.querySelector<HTMLElement>("[data-slot='pane-workspace']")!;
  expect(workspace.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
  expect(workspace.classList.contains("overflow-hidden")).toBe(false);
  const visual = container.querySelector<HTMLElement>("[data-kind='visual']")!;
  expect(visual.parentElement?.classList.contains("overflow-hidden")).toBe(false);
  expect(
    visual.querySelector("[data-slot='pane-body']")?.classList.contains("overflow-hidden"),
  ).toBe(true);

  rerender(
    <PaneWorkspace
      navigation={<Pane kind="navigation">nav</Pane>}
      visual={<Pane kind="visual">plan</Pane>}
      content={<Pane kind="content">table</Pane>}
      inspector={<Pane kind="inspector">inspect</Pane>}
    />,
  );
  expect(workspace.style.gridTemplateColumns).toBe(
    "288px var(--gutter) minmax(0, 1fr) var(--gutter) 320px",
  );
});

test("artifact feet keep their top separator", () => {
  const { container } = render(
    <ArtifactFrame head="head" foot="foot">
      body
    </ArtifactFrame>,
  );
  const rails = container.querySelectorAll("[data-slot='rail']");
  expect(rails).toHaveLength(2);
  expect(rails[1]?.classList.contains("hairline-t")).toBe(true);
  expect(rails[1]?.classList.contains("hairline-b")).toBe(false);
});

test("artifact rail keeps disabled commit refusals in the button title", () => {
  const reason = "Resolve validation errors before committing.";
  render(
    <ArtifactFrame
      head="table"
      headTrail={
        <ActionButton
          tone="commit"
          label="Commit"
          reason={reason}
          disabled
          onClick={() => undefined}
        />
      }
    >
      body
    </ArtifactFrame>,
  );

  expect(screen.getByRole("button", { name: "Commit" }).getAttribute("title")).toBe(reason);
  expect(screen.queryByText(reason)).toBeNull();
});

test("a collapsed flank keeps its shortcut registration and hides its body", () => {
  const run = vi.fn();
  const { container } = render(
    <Pane
      kind="flank"
      title="rooms"
      collapsed
      shortcuts={[{ hotkey: "J", label: "next room", callback: run }]}
    >
      hidden body
    </Pane>,
  );
  const pane = container.querySelector<HTMLElement>("[data-slot='pane']")!;

  act(() => pane.focus());
  fireEvent.keyDown(pane, { key: "j", code: "KeyJ" });
  expect(run).toHaveBeenCalledOnce();
  expect(screen.getByText("rooms")).toBeTruthy();
  expect(screen.queryByText("hidden body")).toBeNull();
  expect(container.querySelector("[data-slot='pane-header']")).toBeNull();
});

test("pane boundaries show suspension, retry errors, and recover for a new target", () => {
  const waiting = new Promise<void>(() => {});
  const Waiting = () => {
    throw waiting;
  };
  const Broken = ({ target }: { target: string }) => {
    if (target === "old") throw new Error("old target failed");
    return <>new target</>;
  };
  const onRetry = vi.fn();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const loading = render(
    <Pane kind="content" title="rooms">
      <Waiting />
    </Pane>,
  );
  expect(screen.getByRole("status").textContent).toBe("loading rooms…");
  loading.unmount();

  const view = render(
    <Pane kind="content" title="rooms" onRetry={onRetry} boundaryKey="old">
      <Broken target="old" />
    </Pane>,
  );
  expect(screen.getByRole("alert").textContent).toContain("rooms failed to load");
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(onRetry).toHaveBeenCalledOnce();

  view.rerender(
    <Pane kind="content" title="rooms" boundaryKey="new">
      <Broken target="new" />
    </Pane>,
  );
  expect(screen.getByText("new target")).toBeTruthy();
  error.mockRestore();
});

test("boundary opt-out renders normal content without a recovery state", () => {
  render(
    <Pane kind="content" boundary={false}>
      plain body
    </Pane>,
  );
  expect(screen.getByText("plain body")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
