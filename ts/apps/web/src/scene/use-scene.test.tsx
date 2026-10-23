// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { sceneRequest } from "./host";
import { useScene } from "./use-scene";

const call = vi.hoisted(() => ({
  data: { id: "partial-context" },
  pending: false,
  error: null,
  refresh: vi.fn(),
}));
vi.mock("#/readings", () => ({ useHostOp: () => call }));
vi.mock("./artifact", () => ({ fetchSceneArtifact: async () => new ArrayBuffer(0) }));
// Hook wiring only: PSC1 decoding has its own binary tests; no native capture or browser layout.
vi.mock("./psc1", () => ({
  decodeScene: () => ({
    meshes: { instances: [], positions: new Float32Array(0) },
    metadata: {
      elements: [],
      stamp: { sources: [] },
      omittedElements: 11636,
      unavailableElements: [{ elementId: 42 }],
    },
  }),
}));

it("forwards capture completeness with the decoded meshes and clears it for an idle request", async () => {
  const request = sceneRequest([71], false);
  const view = renderHook(
    ({ active }) => useScene(active ? request : null, { session: "test", openId: "doc" }, 0),
    { initialProps: { active: true } },
  );
  expect(view.result.current).toMatchObject({
    pending: true,
    omittedElements: 0,
    unavailableElements: 0,
  });
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current).toMatchObject({
    meshes: { instances: [] },
    omittedElements: 11636,
    unavailableElements: 1,
  });
  view.rerender({ active: false });
  expect(view.result.current).toMatchObject({
    meshes: null,
    omittedElements: 0,
    unavailableElements: 0,
  });
  view.unmount();
});
