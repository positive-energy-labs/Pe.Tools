// @vitest-environment jsdom
/**
 * The Situation's verb row runs a verb with no input. A verb whose input is an empty object runs;
 * a verb that needs an input it was not given refuses by name, never with a raw schema message.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { peReadings } from "#/readings";
import { z } from "zod";
import { defineRoute } from "./manifest";
import { schedulesManifest } from "./schedules/manifest";
import { useRoute } from "./use-route";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the verb row's bare run of list schedules (an empty-object input) runs", async () => {
  const accept = new Map<string, Parameters<typeof peReadings.subscribe>[1]>();
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, next) => {
    accept.set(request.kind, next);
    return () => {};
  });
  const { result } = renderHook(() =>
    useRoute(schedulesManifest(), {
      target: JSON.stringify({ kind: "open", ref: { session: "A", openId: "doc-1" } }),
    }),
  );
  act(() =>
    accept.get("inventory")?.({
      kind: "snapshot",
      key: "inventory",
      value: {
        sessions: [
          {
            connected: true,
            sessionId: "A",
            openDocumentCount: 1,
            openDocuments: [
              { openId: "doc-1", title: "Same", address: null, isFamilyDocument: false },
            ],
          },
        ],
      },
    } as never),
  );
  expect(result.current.resolution.kind).toBe("resolved");
  let listed: unknown;
  await act(async () => {
    listed = await result.current.actions.catalog.run();
  });
  expect(listed).toBeNull();
});

test("a verb that needs an input it was not given refuses by name", async () => {
  vi.spyOn(peReadings, "subscribe").mockImplementation(() => () => {});
  const manifest = defineRoute({
    key: "needs-input",
    name: "Needs input",
    actions: {
      open: {
        label: "open schedule",
        says: "opens the chosen schedule",
        needs: "host",
        actor: "any",
        input: z.object({ scheduleId: z.number() }) as never,
        dirties: [],
        ready: () => null,
        run: async () => {},
      },
    },
  });
  const { result } = renderHook(() => useRoute(manifest));
  let read: unknown;
  await act(async () => {
    read = await result.current.actions.open.run();
  });
  expect(read).toMatchObject({
    code: "not-ready",
    message: "open schedule needs its input (scheduleId); run it from where it is chosen",
  });
});
