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

test("an action cannot replace newer member navigation within the same target and Work", async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const manifest = defineRoute({
    key: "late-member",
    name: "Late member",
    page: z.object({ member: z.string(), review: z.string().nullable() }),
    actions: {
      capture: {
        label: "capture",
        says: "captures one member",
        needs: "host",
        actor: "any",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: [],
        ready: () => null,
        run: async (ctx) => {
          await held;
          ctx.setPage({ member: "captured-old", review: "old result" });
        },
      },
    },
  });
  try {
    const { result } = renderHook(() =>
      useRoute(manifest, { work: "shared", page: { member: "A", review: null } }),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.actions.capture.run();
    });
    act(() => result.current.page[1]({ member: "B" }));
    act(() => result.current.page[1]({ member: "A" }));
    await act(async () => {
      release();
      await pending;
    });
    expect(result.current.page[0]).toEqual({ member: "A", review: null });
  } finally {
    cleanup();
  }
});

test("action page progress continues until a user selection or review change supersedes it", async () => {
  let release = () => {};
  let held = Promise.resolve();
  const hold = () => {
    held = new Promise<void>((resolve) => (release = resolve));
  };
  const manifest = defineRoute({
    key: "page-progress",
    name: "Page progress",
    page: z.object({
      progress: z.string(),
      selection: z.array(z.string()),
      review: z.string().nullable(),
    }),
    actions: {
      plan: {
        label: "plan",
        says: "publishes two steps",
        needs: "host",
        actor: "any",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: [],
        ready: () => null,
        run: async (ctx) => {
          ctx.setPage({ progress: "generated" });
          await held;
          ctx.setPage({ progress: "planned", selection: ["old"], review: "old review" });
        },
      },
    },
  });
  try {
    const { result } = renderHook(() =>
      useRoute(manifest, {
        work: "shared",
        page: { progress: "idle", selection: [], review: null },
      }),
    );

    hold();
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.actions.plan.run();
    });
    expect(result.current.page[0].progress).toBe("generated");
    await act(async () => {
      release();
      expect(await pending).toBeNull();
    });
    expect(result.current.page[0]).toEqual({
      progress: "planned",
      selection: ["old"],
      review: "old review",
    });

    hold();
    act(() => {
      pending = result.current.actions.plan.run();
    });
    expect(result.current.page[0].progress).toBe("generated");
    act(() => result.current.page[1]({ selection: ["new"], review: null }));
    await act(async () => {
      release();
      expect(await pending).toBeNull();
    });
    expect(result.current.page[0]).toEqual({
      progress: "generated",
      selection: ["new"],
      review: null,
    });
    expect(result.current.outcome).toMatchObject({ key: "plan", refusal: null });
  } finally {
    cleanup();
  }
});
