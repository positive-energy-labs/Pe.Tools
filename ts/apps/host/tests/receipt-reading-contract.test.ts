import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  actionReceiptSchema,
  actionReceiptListDecoder,
  actionStatusSchema,
  bindWork,
  type ReadingFrame,
  type WorkKey,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { ActionJournal } from "../src/action-journal.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import { bindFixtureCommands, invokeCommand } from "./command-fixture.ts";

// TODO: Confirm /schedules grid and pre-read /families heads in controlled session u2-r3.
test.each(["families", "schedules"])(
  "%s Work receives full journal results; discovery receives summaries",
  async (route) => {
    const directory = await mkdtemp(join(tmpdir(), "pe-receipt-contract-"));
    const releases: (() => void)[] = [];
    try {
      const journal = new ActionJournal(join(directory, "journal.jsonl"), Date.now);
      const work = bindWork(route, null);
      let saved: unknown = null;
      const workspace = new RouteWorkspace({
        registrations: [
          {
            spec: {
              route,
              title: route,
              description: route,
              schema: z.object({ cells: z.record(z.string(), z.unknown()).default({}) }),
              editable: [["cells"]],
            },
          },
        ],
        store: {
          getState: async () => saved,
          setState: async ({ value }) => {
            saved = value;
          },
        },
      });
      await workspace.publish(work, route, [{ path: ["cells"], value: {} }], 0);
      const revision = (await workspace.view(work, route))!.revision;
      bindFixtureCommands(journal, { work: workspace });
      await invokeCommand(
        journal,
        {
          id: "applied",
          key: `test.${route}.apply`,
          target: { kind: "host" },
          input: {},
          caller: { kind: "human", via: "local" },
          basis: { kind: "human" },
          consumes: [
            {
              kind: "work",
              probe: { handle: { key: work, revision }, paths: [["cells"]] },
              expected: { cells: {} },
            },
          ],
        },
        async () => ({ snapshot: "x".repeat(2 * 1024 * 1024) }),
        async () => ({ failures: [{ key: "cell", error: "refused" }] }),
      );
      const receipt = await journal.wait("applied");
      expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded" });
      const observe = hostResourceObserver(undefined, () => journal);
      const read = (key?: WorkKey, detail?: "status") =>
        new Promise<unknown>((resolve, reject) => {
          releases.push(
            observe({ kind: "receipts", ...(key && { work: key }), ...(detail && { detail }) }, (frame: ReadingFrame) => {
              if (frame.kind === "snapshot") resolve(JSON.parse(JSON.stringify(frame.value)));
              else if (frame.kind === "failure") reject(Error(frame.error));
            }),
          );
        });
      const payload = await read(work);
      // The browser's decoder and its generated JSON Schema projection read the actual host frame.
      const decoded = actionReceiptSchema.array().parse(payload);
      expect(actionReceiptListDecoder().parse(payload)).toEqual(payload);
      expect(decoded).toEqual([receipt]);
      expect(decoded[0]).toMatchObject({
        result: { failures: [{ key: "cell", error: "refused" }] },
        steps: [],
        prepared: { state: "ready" },
        recovery: [],
      });
      const timeline = await read(work, "status");
      expect(timeline).toEqual(actionStatusSchema.array().parse([receipt]));
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(2 * 1024 * 1024);
      expect(Buffer.byteLength(JSON.stringify(timeline))).toBeLessThan(10_000);
      const summaries = actionStatusSchema.array().parse(await read());
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).not.toHaveProperty("prepared");
      expect(summaries[0]).not.toHaveProperty("result");
      expect(actionReceiptListDecoder().safeParse(summaries).success).toBe(false);
      expect(await read(bindWork("other-work", null))).toEqual([]);
    } finally {
      releases.forEach((release) => release());
      await rm(directory, { recursive: true, force: true });
    }
  },
);
