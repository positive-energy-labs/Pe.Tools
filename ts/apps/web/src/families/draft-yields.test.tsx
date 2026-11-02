// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { renderHook } from "@testing-library/react";
import { useDraftYieldsToWork } from "./store";

test("N4: a restored draft survives the first Work read and yields once an acknowledged read moves the scope", () => {
  const one = { categories: ["Mechanical Equipment"], families: ["Broan_B1X0E65RT_ERV"], placement: "PlacedOnly" };
  let page: { draft: unknown } = { draft: one };
  const setPage = vi.fn((next: { draft: unknown }) => void (page = { ...page, ...next }));
  const owner = { view: { read: () => ({ page }), setPage } } as never;
  const edit = (families: string[]) => JSON.stringify({ ...one, families });
  const { rerender } = renderHook(({ scope }) => useDraftYieldsToWork(owner, scope), {
    initialProps: { scope: undefined as string | undefined },
  });
  rerender({ scope: edit(["Broan_B1X0E65RT_ERV"]) }); // Work r8 loads: the link's draft stays
  expect(setPage).not.toHaveBeenCalled();
  rerender({ scope: edit(["Broan_B1X0E65RT_ERV", "Broan_B1X0E65RS_ERV"]) }); // r9: the read's scope
  expect(setPage).toHaveBeenCalledWith({ draft: null }, { history: "replace" });
  expect(page.draft).toBeNull();
});
