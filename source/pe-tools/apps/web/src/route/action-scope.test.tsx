// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { peReadings } from "#/readings";
import { defineRoute } from "./manifest";
import { useRoute } from "./use-route";

test("an action completing after an A to B to A target change cannot write the new Page", async () => {
  let inventory!: Parameters<typeof peReadings.subscribe>[1];
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "inventory") inventory = accept;
    return () => {};
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const manifest = defineRoute({
    key: "late-target",
    name: "Late target",
    needs: "project",
    page: z.object({ value: z.string().default("") }),
    actions: {
      refresh: {
        label: "refresh",
        says: "reads once",
        needs: "document",
        actor: "any",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: [],
        ready: () => null,
        run: async (ctx) => {
          await held;
          ctx.setPage({ value: "old target result" });
        },
      },
    },
  });
  const request = (session: string, openId: string) =>
    JSON.stringify({ kind: "open", ref: { session, openId } });
  try {
    const { result, rerender } = renderHook(({ target }) => useRoute(manifest, { target }), {
      initialProps: { target: request("A", "doc-A") },
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
              openDocumentCount: 1,
              openDocuments: [{ openId: "doc-A", address: null, isFamilyDocument: false }],
            },
            {
              connected: true,
              sessionId: "B",
              openDocumentCount: 1,
              openDocuments: [{ openId: "doc-B", address: null, isFamilyDocument: false }],
            },
          ],
        },
      } as never),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.actions.refresh.run();
    });
    rerender({ target: request("B", "doc-B") });
    rerender({ target: request("A", "doc-A") });
    await act(async () => {
      release();
      await pending;
    });
    expect(result.current.page[0].value).toBe("");
  } finally {
    cleanup();
    subscribe.mockRestore();
  }
});
