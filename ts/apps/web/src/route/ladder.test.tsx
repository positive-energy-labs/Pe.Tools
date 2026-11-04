// @vitest-environment jsdom
import { test, expect } from "vite-plus/test";
import { renderHook } from "@testing-library/react";
import { useCollection } from "@pe/kit/lang/collection";
test("independent child hits appear once when searching above a multi-pick rung", () => {
  const hook = renderHook(() =>
    useCollection({
      target: null,
      filter: "substring",
      keyOf: (x: string) => x,
      labelOf: (x: string) => x,
      initialQuery: "Magna3",
      levels: [
        { label: "category", multi: true, items: () => ["Air Terminals", "Mechanical Equipment"] },
        { label: "family", independent: true, items: () => ["Magna3"] },
      ],
    }),
  );
  const hits = hook.result.current.visible.filter((row) => row.kind === "item");
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ path: [], item: "Magna3" });
  hook.unmount();
});
