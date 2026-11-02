// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { test, expect, vi } from "vite-plus/test";
import { useMeasuredParse } from "./measured-parse";
vi.mock("#/host/client", () => ({
  callHostRpc: vi.fn(async () => ({ ok: true, value: 1.1, text: "1" })),
}));
test("staging retains the exact measured number even when project formatting rounds", async () => {
  const hook = renderHook(() => useMeasuredParse("capture"));
  let answer: unknown;
  await act(async () => {
    answer = await hook.result.current(
      { specTypeId: "current", typeId: "amperes", label: "Amperes", symbol: "A" },
      "1.1 A",
    );
  });
  expect(answer).toMatchObject({ value: "1.1", unit: "A" });
  expect(answer).not.toHaveProperty("display", "1 A");
  hook.unmount();
});
