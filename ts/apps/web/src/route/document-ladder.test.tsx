// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { peReadings } from "#/readings";
import { defineRoute } from "./manifest";
import { useDocumentLadder } from "./situation";
import { useRoute } from "./use-route";

vi.mock("./shell", async (original) => ({
  ...(await original<typeof import("./shell")>()),
  useChooseTarget: () => [null, () => {}],
}));

test("the ladder names the resolved session on a route that declares no inventory Reading", () => {
  let inventory!: Parameters<typeof peReadings.subscribe>[1];
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "inventory") inventory = accept;
    return () => {};
  });
  const manifest = defineRoute({
    key: "ladder",
    name: "Ladder",
    needs: "project",
    page: z.object({}),
    actions: {},
  });
  try {
    const { result } = renderHook(() => {
      const handle = useRoute(manifest, {
        target: JSON.stringify({ kind: "open", ref: { session: "A", openId: "doc-A" } }),
      });
      return { resolution: handle.resolution, ladder: useDocumentLadder(handle) };
    });
    act(() =>
      inventory({
        kind: "snapshot",
        key: "inventory",
        value: {
          sessions: [
            {
              connected: true,
              sessionId: "A",
              sdkSessionId: "rvt-1",
              openDocumentCount: 1,
              openDocuments: [
                { openId: "doc-A", title: "Tower", address: null, isFamilyDocument: false },
              ],
            },
          ],
        },
      } as never),
    );
    expect(result.current.resolution.kind).toBe("resolved");
    expect(result.current.ladder.sessionWord).toBe("rvt-1");
    expect(result.current.ladder.docWord).toBe("Tower");
  } finally {
    cleanup();
    subscribe.mockRestore();
  }
});
