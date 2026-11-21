import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { ANY_ROUTE } from "@pe/agent-contracts";
import { commands, tools } from "@pe/mcps/product-actions";
import { workWriteBoundary } from "../src/work-write-boundary.ts";
import type { CommandExecutor } from "@pe/host-internal/command-executor";
import { crossingOf } from "./callers.ts";
import { detachedBridge, testJournal } from "./effect-test.ts";
import { z } from "zod";

// Payload/plan-ticket fixtures belonged to the retired caller-payload boundary.
// Every migrated command must bind executable derivation and refuse foreign Work first.
const writes = Object.entries(commands).filter(([, entry]) => "writeBoundary" in entry);
test.each(writes)(
  "%s links derivation and refuses foreign Work without reading evidence",
  async (key, definition) => {
    if (!("writeBoundary" in definition)) throw Error(`${key} has no write boundary`);
    const hooks = definition.writeBoundary;
    expect(typeof hooks.derive).toBe("function");
    expect(typeof hooks.preview).toBe("function");
    const executor: CommandExecutor = {
      definition,
      prepared: z.unknown(),
      seal: () => {
        throw Error("must not project foreign Work");
      },
      bind: async () => {
        throw Error("must not derive foreign Work");
      },
      run: () => Effect.fail(Error("must not dispatch foreign Work")),
    };
    const bridge = detachedBridge();
    const boundary = workWriteBoundary(executor, bridge);
    const bind = vi.fn(boundary.bind);
    const journal = testJournal();
    journal.bindCommands({ probe: async () => null, resolve: () => ({ ...boundary, bind }) });
    const id = `foreign:${key}`;
    await journal.invoke(
      {
        id,
        key,
        target: { kind: "document", ref: { session: "A", openId: "A" } },
        input: {
          work: {
            key: {
              binding: "open",
              route: hooks.route === ANY_ROUTE ? tools.ducts.work.route : hooks.route,
              target: null,
              open: { session: "A", openId: "B" },
            },
            revision: 1,
          },
        },
      },
      crossingOf(),
    );
    expect(await journal.wait(id)).toMatchObject({
      state: "failed",
      notDispatched: true,
      refusal: { code: "work.target", message: "Work belongs to another document" },
    });
    expect(bind).not.toHaveBeenCalled();
    const missingDerive = { ...definition, writeBoundary: { ...hooks, derive: undefined } };
    expect(() => workWriteBoundary({ ...executor, definition: missingDerive }, bridge)).toThrow(
      "typed derive and preview",
    );
  },
);
