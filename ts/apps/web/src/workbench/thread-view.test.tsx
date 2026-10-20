// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { makeAtomRegistry } from "#/route/route-owner";
import { CurrentThreadViewOwner, useCurrentThreadView } from "./thread-view";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
});

function mount(turn?: number) {
  let view!: ReturnType<typeof useCurrentThreadView>;
  const Probe = () => {
    view = useCurrentThreadView();
    return null;
  };
  render(
    <CurrentThreadViewOwner threadKey="t1" registry={makeAtomRegistry()} turn={turn}>
      <Probe />
    </CurrentThreadViewOwner>,
  );
  return () => view;
}

test("a scroll never touches the URL; a reload in the tab lands where it stood", () => {
  vi.useFakeTimers();
  const replaced = vi.spyOn(window.history, "replaceState");
  const pushed = vi.spyOn(window.history, "pushState");
  const view = mount();
  act(() => view().actions.setLensIntent({ kind: "turn", turn: 7 }));
  act(() => void vi.advanceTimersByTime(300));
  expect(replaced).not.toHaveBeenCalled();
  expect(pushed).not.toHaveBeenCalled();
  cleanup();
  const reloaded = mount();
  expect(reloaded().registry.get(reloaded().atoms.lensIntent)).toEqual({ kind: "turn", turn: 7 });
});

test("a different deep link wins over the stored position", () => {
  vi.useFakeTimers();
  const view = mount();
  act(() => view().actions.setLensIntent({ kind: "turn", turn: 7 }));
  act(() => void vi.advanceTimersByTime(300));
  cleanup();
  const linked = mount(3);
  expect(linked().registry.get(linked().atoms.lensIntent)).toEqual({ kind: "turn", turn: 3 });
});
