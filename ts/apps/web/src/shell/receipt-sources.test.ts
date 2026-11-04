import { afterEach, expect, test, vi } from "vite-plus/test";
import { actionReceiptSchema, bindWork } from "@pe/agent-contracts";
import { peReadings } from "../readings";
import { schedulesKernelSources as schedulesSources } from "../schedules/kernel-sources";
import { scheduleOutcome } from "../schedules/neutral";
import { createReadingGraph } from "./readings";

afterEach(() => vi.restoreAllMocks());

test.each(["schedules"])(
  "%s receipts demand the current Work and decode full results",
  async (route) => {
    const work = bindWork(route, null);
    const receipt = actionReceiptSchema.parse({
      id: "push",
      key: "schedule.grid.push",
      state: "succeeded",
      target: { kind: "host" },
      caller: { kind: "human", via: "local" },
      basis: null,
      input: {},
      steps: [],
      prepared: { state: "ready", value: null },
      recovery: [],
      result: { failures: [{ key: "cell", error: "refused" }] },
      startedAt: "2026-11-02T10:00:00Z",
    });
    const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
      expect(request).toEqual({ kind: "receipts", work });
      accept({ kind: "snapshot", key: "receipts", value: [receipt] });
      return () => {};
    });
    const sources = schedulesSources();
    const graph = createReadingGraph(
      {
        readings: {
          receipts: {
            kind: "use",
            source: `${route}.receipts`,
            args: () => work,
            retire: "target",
          },
        },
      },
      {
        sources,
        scope: { target: { kind: "host" }, workKey: work, workRevision: 0, page: {}, work: null },
        log: () => {},
      },
    );
    try {
      expect(graph.get("receipts").status).toBe("absent");
      expect(subscribe).not.toHaveBeenCalled();
      graph.mount(["receipts"]);
      await vi.waitFor(() => expect(graph.get("receipts").status).toBe("ready"));
      expect(graph.get("receipts").value).toEqual([receipt]);
      expect(scheduleOutcome(graph.get("receipts").value as (typeof receipt)[]).refused).toEqual({
        cell: "refused",
      });
    } finally {
      graph.dispose();
    }
  },
);
