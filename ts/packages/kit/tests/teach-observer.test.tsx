// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useTeach, useTeaching } from "../src/components/lang/use-teach";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
test("readers share one observer; only changed regions read geometry once per frame; no readers do no work", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const NativeObserver = MutationObserver;
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  const observers = vi
    .spyOn(globalThis, "MutationObserver")
    .mockImplementation(function (callback) {
      return new NativeObserver(callback);
    });
  const geometry = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 200, 100));
  function Fact({ label }: { label: string }) {
    const host = useRef<HTMLDivElement>(null);
    const id = useTeach({ kind: "region", label }, true, host);
    return <div ref={host} data-teach-id={id} />;
  }
  const view = render(
    <>
      {Array.from({ length: 12 }, (_, i) => (
        <Fact key={i} label={String(i)} />
      ))}
    </>,
  );
  expect(observers).not.toHaveBeenCalled();
  expect(geometry).not.toHaveBeenCalled();
  const first = renderHook(useTeaching);
  const second = renderHook(useTeaching);
  expect(observers).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersToNextFrame());
  expect(geometry).toHaveBeenCalledTimes(12);
  geometry.mockClear();
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      view.container.firstElementChild!.textContent = String(i);
      await Promise.resolve();
    }
  });
  expect(geometry).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
  await act(() => vi.advanceTimersToNextFrame());
  expect(geometry).toHaveBeenCalledOnce();
  const unrelated = document.createElement("div");
  await act(async () => {
    document.body.append(unrelated);
    await Promise.resolve();
    unrelated.remove();
  });
  expect(vi.getTimerCount()).toBe(0);
  first.unmount();
  expect(disconnect).not.toHaveBeenCalled();
  second.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  geometry.mockClear();
  await act(async () => {
    view.container.firstElementChild!.textContent = "closed";
    await Promise.resolve();
  });
  expect(geometry).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
