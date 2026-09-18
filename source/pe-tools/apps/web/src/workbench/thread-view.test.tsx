// @vitest-environment jsdom
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("#/route", async () => {
  const route = await import("#/route/use-route");
  return { createRouteOwner: route.createRouteOwner, useRouteOwner: route.useRouteOwner };
});

import {
  CurrentThreadViewOwner,
  useCurrentThreadView,
  type CurrentThreadView,
} from "./thread-view";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("only selection replaces the transient owner; StrictMode cleans each owner once", async () => {
  vi.useFakeTimers();
  const registry = AtomRegistry.make();
  const seen: CurrentThreadView[] = [];
  function Probe() {
    const view = useCurrentThreadView();
    useEffect(() => void seen.push(view), [view]);
    return <button onClick={() => view.actions.setLensInspectKey("tool")}>mark</button>;
  }
  function Shell() {
    const [thread, setThread] = useState("a");
    const [turn, setTurn] = useState<number | undefined>(1);
    const [tick, setTick] = useState(0);
    return (
      <>
        <button onClick={() => setTick((value) => value + 1)}>render {tick}</button>
        <button onClick={() => setTurn(2)}>turn</button>
        <button onClick={() => setThread("b")}>thread</button>
        <CurrentThreadViewOwner
          threadKey={thread}
          registry={registry}
          turn={turn}
          patch={async () => undefined}
        >
          <Probe />
        </CurrentThreadViewOwner>
      </>
    );
  }

  const view = render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  );
  const ownerA = seen.at(-1)!;
  const disposeA = vi.spyOn(ownerA, "dispose");
  fireEvent.click(screen.getByRole("button", { name: /mark/ }));
  fireEvent.click(screen.getByRole("button", { name: /render/ }));
  fireEvent.click(screen.getByRole("button", { name: "turn" }));
  expect(seen.at(-1)).toBe(ownerA);
  expect(registry.get(ownerA.atoms.lensInspectKey)).toBe("tool");

  fireEvent.click(screen.getByRole("button", { name: "thread" }));
  const ownerB = seen.at(-1)!;
  expect(ownerB).not.toBe(ownerA);
  expect(registry.get(ownerB.atoms.lensInspectKey)).toBeNull();
  expect(disposeA).toHaveBeenCalledOnce();
  const disposeB = vi.spyOn(ownerB, "dispose");
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(disposeB).toHaveBeenCalledOnce();
});
