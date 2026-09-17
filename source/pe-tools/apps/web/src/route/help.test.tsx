// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { RouteHelpButton } from "./help";

afterEach(cleanup);

test("help explains every rendered pane and the route instructions", async () => {
  const panes = document.createElement("div");
  panes.innerHTML = `
    <section data-slot="pane"><h2 data-slot="pane-title">Source</h2></section>
    <section data-slot="pane"><h2 data-slot="pane-title">Review</h2></section>
  `;
  document.body.append(panes);

  render(
    <RouteHelpButton name="Example" docs={<p>Review the staged changes before applying.</p>} />,
  );
  fireEvent.click(screen.getByTitle(/how this route works/));

  expect(await screen.findByText("Source · keys")).toBeTruthy();
  expect(screen.getByText("Review · keys")).toBeTruthy();
  expect(screen.getByText("Review the staged changes before applying.")).toBeTruthy();
  panes.remove();
});
