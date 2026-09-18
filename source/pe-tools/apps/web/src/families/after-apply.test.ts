// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { renderHook } from "@testing-library/react";

import { useAfterApply } from "./workspace";

test("the scope re-resolves once when an apply settles, and never for another verb", () => {
  const reresolve = vi.fn();
  const { rerender } = renderHook(({ busy }) => useAfterApply(busy, reresolve), {
    initialProps: { busy: null as string | null },
  });
  for (const busy of ["plan", null, "apply", "apply"]) rerender({ busy });
  expect(reresolve).not.toHaveBeenCalled();
  rerender({ busy: null });
  expect(reresolve).toHaveBeenCalledTimes(1);
  rerender({ busy: "capture" });
  rerender({ busy: null });
  expect(reresolve).toHaveBeenCalledTimes(1);
});
