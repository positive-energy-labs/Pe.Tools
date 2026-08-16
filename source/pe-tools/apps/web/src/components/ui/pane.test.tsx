// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { Pane, PaneWorkspace } from "#/components/ui/pane";

afterEach(cleanup);

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
