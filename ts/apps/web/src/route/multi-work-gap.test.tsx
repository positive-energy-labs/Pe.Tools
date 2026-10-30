// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { bindWork, readingKey, workWriteSchema, type RouteStateSpec } from "@pe/agent-contracts";
import { peReadings } from "#/readings";
import { acquireWorkJournal } from "#/shell/journal";
import * as host from "./host";
import { useRouteWorks } from "./route-work";

test("kernel gap: a Chat head Work write acknowledges the canonical kernel journal", async () => {
  const schema = z.object({ count: z.number().default(0) });
  const spec: RouteStateSpec<typeof schema> = {
    route: "head-journal-gap",
    title: "Head journal",
    description: "Multi-Work admission",
    schema,
  };
  const key = bindWork(spec.route, null, crypto.randomUUID());
  const entries = [{ spec, key }];
  const held = acquireWorkJournal(key);
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "work")
      accept({
        kind: "snapshot",
        key: readingKey(request),
        value: { revision: 3, doc: schema.parse({}) },
      } as never);
    return () => {};
  });
  vi.spyOn(host, "postRouteWrite").mockImplementation(async (_operation, _input, body) => {
    const write = workWriteSchema.parse(body);
    return {
      status: 200,
      result: {
        ok: true,
        revision: 4,
        write: {
          key,
          kind: write.kind,
          by: "human",
          press: write.press,
          base: 3,
          revision: 4,
          patches: write.patches,
          inverse: [{ path: ["count"], value: 0 }],
          undoable: true,
        },
      },
    };
  });
  try {
    const hook = renderHook(() => useRouteWorks(entries));
    expect(hook.result.current[0]!.revision).toBe(3);
    await act(async () => {
      expect(
        await hook.result.current[0]!.write([{ path: ["count"], value: 1 }], 3, {
          press: "head-take",
        }),
      ).toBeNull();
    });
    expect(held.journal.read().undo.map((step) => step.press)).toEqual(["head-take"]);
  } finally {
    cleanup();
    held.release();
    vi.restoreAllMocks();
  }
});
