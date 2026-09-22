/**
 * The scope tree (ledger 2026-09-22): focus decides the innermost live node, the innermost
 * binding wins, and a hidden node binds nothing while it stays mounted.
 */
// @vitest-environment jsdom
import { useRef, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { Pane } from "#/components/lang/pane";

import { KeyScope, useScopeKeys } from "./keys";

afterEach(cleanup);

function Region({
  id,
  hidden,
  onKey,
  children,
}: {
  id: string;
  hidden?: boolean;
  onKey: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <KeyScope id={id} element={ref} hidden={hidden}>
      <div ref={ref} data-testid={id} tabIndex={-1}>
        <Chords onKey={onKey} />
        {children}
      </div>
    </KeyScope>
  );
}

function Chords({ onKey }: { onKey: () => void }) {
  useScopeKeys([{ hotkey: "J", callback: onKey, label: "jump" }]);
  return null;
}

test("the innermost live node wins, and focus is what decides which node that is", () => {
  const outer = vi.fn();
  const inner = vi.fn();
  render(
    <Region id="pane" onKey={outer}>
      <Region id="grid" onKey={inner} />
    </Region>,
  );
  const grid = screen.getByTestId("grid");
  grid.focus();
  fireEvent.keyDown(grid, { key: "j" });
  expect(inner).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();

  // Focus back out to the pane: the pane is now the innermost node the key reaches.
  const pane = screen.getByTestId("pane");
  pane.focus();
  fireEvent.keyDown(pane, { key: "j" });
  expect(inner).toHaveBeenCalledTimes(1);
  expect(outer).toHaveBeenCalledTimes(1);
});

test("a hidden node binds nothing, and nothing under it does either", () => {
  const pane = vi.fn();
  const region = vi.fn();
  render(
    <Region id="pane" hidden onKey={pane}>
      <Region id="grid" onKey={region} />
    </Region>,
  );
  const grid = screen.getByTestId("grid");
  grid.focus();
  fireEvent.keyDown(grid, { key: "j" });
  expect(region).not.toHaveBeenCalled();
  expect(pane).not.toHaveBeenCalled();
});

test("a node with no element binds on the document, so its chord fires with nothing focused", () => {
  const route = vi.fn();
  render(
    <KeyScope id="route">
      <Chords onKey={route} />
    </KeyScope>,
  );
  fireEvent.keyDown(document.body, { key: "j" });
  expect(route).toHaveBeenCalledTimes(1);
});

test("a hidden pane stays mounted and binds nothing; showing it binds again", () => {
  const run = vi.fn();
  const pane = (hidden: boolean) => (
    <Pane
      kind="content"
      id="grid"
      hidden={hidden}
      title="grid"
      shortcuts={[{ hotkey: "J", label: "next room", callback: run }]}
    >
      <button type="button">inside</button>
    </Pane>
  );
  const view = render(pane(true));
  const inside = screen.getByText("inside");
  inside.focus();
  fireEvent.keyDown(inside, { key: "j" });
  expect(run).not.toHaveBeenCalled();

  view.rerender(pane(false));
  screen.getByText("inside").focus();
  fireEvent.keyDown(screen.getByText("inside"), { key: "j" });
  expect(run).toHaveBeenCalledTimes(1);
});
