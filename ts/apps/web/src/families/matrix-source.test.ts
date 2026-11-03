import { expect, test, vi } from "vite-plus/test";
import { familiesModule } from "./kernel";
import { peReadings } from "../readings";
import * as api from "../shell/readings-api";
import * as client from "../../../../packages/mcps/src/shared/families-client";
import { familiesMatrixEnvelopeSchema } from "@pe/agent-contracts";
import { familiesMatrixSource } from "./matrix-source";

test("registered progressive source assembles immutable parts and preserves the POST completion", async () => {
  expect(typeof familiesModule.sources["families.read"].open).toBe("function");
  const document = { session: "fixture", openId: "families" };
  const filter = {
    categoryNames: ["Equipment"],
    familyNames: [],
    placementScope: "AllLoaded" as const,
  };
  const work = { binding: "open" as const, route: "families", target: null, open: document };
  const reading = {
    id: "progress",
    work,
    document,
    filter,
    capturedAt: "2026-11-03T00:00:00Z",
    completedAt: "2026-11-03T00:00:00Z",
    result: { families: [], issues: [], page: null },
  };
  let finish!: (v: any) => void;
  const post = vi.spyOn(client, "readFamiliesCapture").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let frame!: (f: any) => void;
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((_, accept) => {
    frame = accept;
    return () => {};
  });
  const parts = vi.spyOn(api, "callCompose").mockResolvedValue({
    reading: {
      ...reading,
      progress: {
        runId: "run",
        state: "reading",
        phase: "extract",
        completed: 0,
        total: 1,
        workers: 1,
      },
    },
    records: [],
  } as never);
  const controller = new AbortController();
  const deliver = vi.fn();
  try {
    const source = familiesMatrixSource(peReadings);
    const release = await source.open(
      {
        target: { kind: "document", ref: document },
        workKey: work,
        workRevision: 0,
        page: {},
        work: null,
        args: { filter, readId: "00000000-0000-4000-8000-000000000001", expectedRevision: 0, work },
        attempt: { target: { kind: "document", ref: document }, workKey: work, generation: 1 },
        signal: controller.signal,
        trigger: { kind: "demand" },
        inputs: {},
      },
      deliver,
    );
    expect(post).toHaveBeenCalledOnce();
    // The subscription announces only immutable body versions; the source owns assembly.
    frame({
      kind: "snapshot",
      key: "matrix",
      value: familiesMatrixEnvelopeSchema.parse({
        bodyVersion: "a".repeat(64),
        reading: { at: null, version: "v1", observedAt: "2026-11-03T00:00:00Z" },
      }),
    });
    await vi.waitFor(() => expect(parts).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ kind: "part" })),
    );
    finish(reading);
    await vi.waitFor(() =>
      expect(deliver.mock.calls.filter(([e]) => e.kind === "complete").length).toBe(1),
    );
    controller.abort();
    release?.();
  } finally {
    subscribe.mockRestore();
    parts.mockRestore();
    post.mockRestore();
  }
});
