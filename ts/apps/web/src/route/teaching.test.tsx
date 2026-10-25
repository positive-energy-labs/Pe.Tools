// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { renderToString, renderToStaticMarkup } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { actionScopeKeys, actionTeaching, chordLabel } from "@pe/kit/keys";
import { declaredTeaching, registerTeaching, type Teaching } from "@pe/kit/lang/teach";
import { TeachingLayoutView } from "@pe/kit/lang/teaching-layout";
import { TeachPage, TeachReference, useTeaching } from "@pe/kit/lang/use-teach";
import { DUCTS_LAYOUT, DUCTS_TEACHING } from "#/ducts/proto/e/teaching";
import { STAGE_ACTIONS } from "#/scene/stage-teaching";
import { HelpWorld } from "./help";
import { STARTUP_TEACHING } from "./teaching";

afterEach(cleanup);

test("changing the shared action changes reference and actual scoped bindings together", () => {
  const action = {
    ...STAGE_ACTIONS.frame,
    label: "changed frame",
    bindings: ["Shift+F" as const],
    invoke: vi.fn(),
  };
  const [reference] = actionTeaching([action]);
  const [live] = actionScopeKeys([action]);
  expect(reference).toEqual({
    keys: [chordLabel(live!.hotkey)],
    label: live!.label,
    says: live!.says,
  });
  expect(reference!.keys).not.toEqual(actionTeaching([STAGE_ACTIONS.frame])[0]!.keys);
  expect(action.invoke).not.toHaveBeenCalled();
});

test("a shared split change reaches the rendered layout and reference rectangles", () => {
  const layout = {
    ...DUCTS_LAYOUT,
    size: 512,
    start: { ...DUCTS_LAYOUT.start, axis: "horizontal" as const },
  };
  const reference = declaredTeaching(layout);
  expect(reference.find((f) => f.kind === "region" && f.id === "rules")).toMatchObject({
    rect: { left: 336, top: 0, width: 176 },
  });
  const html = renderToStaticMarkup(
    <TeachingLayoutView
      layout={layout}
      panes={{ systems: "systems", rules: "rules", picture: "picture", rulings: "rulings" }}
      resize={{ sidebar: { minSize: 0 }, stack: { minSize: 0 }, drawing: { minSize: 0 } }}
    />,
  );
  expect(html).toContain("512px");
  const container = document.createElement("div");
  container.innerHTML = html;
  expect(
    [...container.querySelectorAll("[data-slot=pane-split]")].map((node) =>
      node.getAttribute("data-axis"),
    ),
  ).toEqual(["horizontal", "horizontal", "horizontal"]);
});

test("reference projection removes runtime claims even from an accidentally stateful declaration", () => {
  const facts = declaredTeaching({
    id: "one",
    label: "One",
    controls: [
      {
        kind: "views",
        label: "layers",
        options: [{ key: "x", label: "X", active: true, disabled: true }],
      },
      {
        kind: "keys",
        scope: "One",
        items: [{ keys: ["F"], label: "frame", refusal: "No document" }],
      },
    ],
  });
  expect(facts[1]).toMatchObject({ options: [{ key: "x", label: "X" }] });
  expect(JSON.stringify(facts)).not.toMatch(/active|disabled|refusal/);
});

function Tutorial() {
  return <HelpWorld facts={useTeaching()} />;
}
test("empty measurements keep the reference; route changes exclude another retained page", () => {
  const a: Teaching = {
    kind: "region",
    id: "live",
    label: "Measured ducts",
    page: "/ducts",
    rect: { left: 0, top: 0, width: 500, height: 300 },
  };
  const withdraw = registerTeaching(a);
  const view = render(
    <TeachPage value="/ducts">
      <TeachReference value={DUCTS_TEACHING}>
        <Tutorial />
      </TeachReference>
    </TeachPage>,
  );
  expect(view.container.textContent).toContain("Measured ducts");
  view.rerender(
    <TeachPage value="/family">
      <TeachReference value={STARTUP_TEACHING}>
        <Tutorial />
      </TeachReference>
    </TeachPage>,
  );
  expect(view.container.textContent).not.toContain("Measured ducts");
  expect(view.container.textContent).toContain("Workspace");
  act(withdraw);
  view.rerender(
    <TeachPage value="/ducts">
      <TeachReference value={DUCTS_TEACHING}>
        <Tutorial />
      </TeachReference>
    </TeachPage>,
  );
  expect(view.container.querySelector("[data-teach-source=reference]")).toBeTruthy();
  expect(view.container.textContent).toContain("All-systems rules");
});

test("SSR never reads the process-global mounted registry and hydrates the same map without warnings", async () => {
  const withdraw = registerTeaching({
    kind: "region",
    id: "secret",
    label: "Another request's document",
    rect: { left: 0, top: 0, width: 1, height: 1 },
  });
  const content = (
    <TeachReference value={STARTUP_TEACHING}>
      <Tutorial />
    </TeachReference>
  );
  const html = renderToString(content);
  withdraw();
  expect(html).not.toContain("Another request");
  expect(html).toContain("data-leader-map");
  expect(html).toMatch(/data-leader-line="[^"]+"[^>]*d="M/);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, content);
  });
  expect(errors.mock.calls).toEqual([]);
  act(() => root.unmount());
  container.remove();
  errors.mockRestore();
});
