// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useCopy } from "../src/lib/use-copy";

afterEach(() => vi.unstubAllGlobals());

test("copied flips only once the clipboard accepts the write, text or image", async () => {
  let accept!: () => void;
  const write = vi.fn(() => new Promise<void>((resolve) => (accept = resolve)));
  vi.stubGlobal("navigator", { clipboard: { writeText: write, write } });
  vi.stubGlobal(
    "ClipboardItem",
    class {
      constructor(readonly items: unknown) {}
    },
  );
  const { result } = renderHook(() => useCopy());
  act(() => result.current.copy(Promise.resolve(new Blob([], { type: "image/png" }))));
  expect(result.current.copied).toBe(false);
  await act(async () => accept());
  expect(result.current.copied).toBe(true);
});

test("a refused write leaves copied down", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: () => Promise.reject(new Error("denied")) },
  });
  const { result } = renderHook(() => useCopy());
  await act(async () => result.current.copy("text"));
  expect(result.current.copied).toBe(false);
});
