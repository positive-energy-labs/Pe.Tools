// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";

import type { Bindings, Runner } from "#/targeting/kit";
import type { Product } from "#/targeting/model";
import { setCurrentManifest } from "./manifest-ref";
import { measureLayout } from "./measure";

afterEach(() => {
  document.body.replaceChildren();
});

test("pane ids win and titles only join panes without ids", () => {
  const product = {
    panes: [
      { key: "structural", label: "wrong title", draws: [] },
      { key: "fallback", label: "title fallback", draws: [] },
    ],
    slots: {},
  } as unknown as Product<string>;
  setCurrentManifest({
    product,
    b: {} as Bindings<string>,
    runner: {} as Runner<string>,
  });
  document.body.innerHTML = `
    <section data-slot="pane" data-kind="content" data-pane-id="structural">
      <div data-slot="pane-header"><h2>rendered title</h2></div>
    </section>
    <section data-slot="pane" data-kind="content">
      <div data-slot="pane-header"><h2>title fallback</h2></div>
    </section>`;

  const layout = measureLayout();

  expect(layout?.panes.map((pane) => pane.model?.key)).toEqual(["structural", "fallback"]);
  expect(layout?.panes.map((pane) => pane.label)).toEqual(["rendered title", "title fallback"]);
});
