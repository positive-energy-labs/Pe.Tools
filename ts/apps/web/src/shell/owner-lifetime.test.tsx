// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createRouteOwner, makeAtomRegistry, useOwned, useRouteOwner } from "./owner";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function chatOwner() {
  const registry = makeAtomRegistry();
  const core = createRouteOwner("chat", registry);
  return {
    ...core,
    dispose: vi.fn(() => {
      core.dispose();
      registry.dispose();
    }),
  };
}

test("folding Pea retains its registry until actual removal, including removal while hidden", async () => {
  vi.useFakeTimers();
  let seen: ReturnType<typeof chatOwner>;
  function Pea() {
    const owner = useRouteOwner(chatOwner);
    seen = owner;
    useOwned(owner.registry, owner.busy);
    return null;
  }
  const tree = (hidden: boolean) => (
    <StrictMode>
      <Activity mode={hidden ? "hidden" : "visible"}>
        <Pea />
      </Activity>
    </StrictMode>
  );
  const view = render(tree(false));
  const original = seen!;
  try {
    view.rerender(tree(true));
    await act(() => vi.runAllTimersAsync());
    view.rerender(tree(false));
    expect(seen!).toBe(original);
    expect(original.dispose).not.toHaveBeenCalled();
    expect(original.registry.get(original.busy)).toBeNull();
    view.rerender(tree(true));
    view.unmount();
    await act(() => vi.runAllTimersAsync());
    expect(original.dispose).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    await act(() => vi.runAllTimersAsync());
  }
});

test("replacing a standalone owner disposes only the retired identity, once under StrictMode", async () => {
  vi.useFakeTimers();
  let seen: ReturnType<typeof chatOwner>;
  function Pea({ thread }: { thread: string }) {
    const owner = useRouteOwner(chatOwner, thread);
    seen = owner;
    useOwned(owner.registry, owner.busy);
    return null;
  }
  const tree = (thread: string) => (
    <StrictMode>
      <Pea thread={thread} />
    </StrictMode>
  );
  const view = render(tree("first"));
  const first = seen!;
  view.rerender(tree("second"));
  const second = seen!;
  await act(() => vi.runAllTimersAsync());
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(second.dispose).not.toHaveBeenCalled();
  expect(second.registry.get(second.busy)).toBeNull();
  view.unmount();
  await act(() => vi.runAllTimersAsync());
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(second.dispose).toHaveBeenCalledTimes(1);
});
