// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, test } from "vite-plus/test";

import { useGroundedDoc } from "#/grounded-doc/engine";
import { SAMPLE_DOC } from "#/grounded-doc/sample";

test("initializes explicitly with a fixture or the ordinary empty state", () => {
  const fixture = renderHook(() => useGroundedDoc({ initialDoc: SAMPLE_DOC }));
  expect(fixture.result.current.doc).toBe(SAMPLE_DOC);
  expect(fixture.result.current.status).toEqual({ phase: "ready" });
  fixture.unmount();

  const empty = renderHook(() => useGroundedDoc());
  expect(empty.result.current.doc).toBeNull();
  expect(empty.result.current.status).toEqual({ phase: "empty" });
});
