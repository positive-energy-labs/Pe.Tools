// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { Pane, PaneWorkspace } from "#/components/lang/pane";

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
  expect(container.querySelector("[data-slot='pane']")?.getAttribute("data-active")).toBe("true");
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

  expect(workspace.style.gridTemplateRows).toBe("340px 8px minmax(0, 1fr)");
  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize pane" }), {
    key: "ArrowDown",
  });
  expect(workspace.style.gridTemplateRows).toBe("356px 8px minmax(0, 1fr)");
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

  expect(workspace.style.gridTemplateRows).toBe("374px 8px minmax(0, 1fr)");
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

  expect(workspace.style.gridTemplateRows).toBe("34px 8px minmax(0, 1fr)");
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
