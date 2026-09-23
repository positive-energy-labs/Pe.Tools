import { browserActionSays } from "@pe/agent-contracts";
// @vitest-environment jsdom
/**
 * The Situation's verb row runs a verb with no input. A verb that needs an input it was not given refuses by name, never with a raw schema message.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { peReadings } from "#/readings";
import { z } from "zod";
import { defineRoute } from "./manifest";
import { useRoute } from "./use-route";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a verb that needs an input it was not given refuses by name", async () => {
  vi.spyOn(peReadings, "subscribe").mockImplementation(() => () => {});
  const manifest = defineRoute({
    key: "needs-input",
    name: "Needs input",
    actions: {
      open: {
        label: "open schedule",
        says: browserActionSays.memberOpen,
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
