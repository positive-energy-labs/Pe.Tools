import { Effect, Exit, Schema } from "effect";
import { expect } from "vite-plus/test";
import { emptyThreadLifecycle } from "@pe/agent-contracts";
import {
  decodeThreadMeta,
  replayThreadEvents,
  ThreadMetaFile,
} from "../src/harness/thread-store.ts";
import { captureLogs, effectTest } from "./effect-test.ts";

const prompt = { seq: 1, at: "2026-11-02T00:00:00.000Z", kind: "prompt", turnId: "t1", text: "hi" };
const turnEnd = {
  seq: 3,
  at: "2026-11-02T00:00:01.000Z",
  kind: "turn_end",
  turnId: "t1",
  stopReason: "end_turn",
};

effectTest(
  "a malformed events.jsonl line is skipped, logged with its path and line, and counted",
  () =>
    Effect.gen(function* () {
      const logs = captureLogs();
      const text = [
        JSON.stringify(prompt),
        '{"seq":2,"kind":"prompt","text":', // torn write
        JSON.stringify({ ...prompt, seq: 2, kind: "no_such_kind" }), // stale kind from another build
        JSON.stringify(turnEnd),
        "",
      ].join("\n");
      const replay = yield* replayThreadEvents("C:/threads/t/events.jsonl", text).pipe(
        Effect.provide(logs.layer),
      );
      expect(replay.events.map((event) => event.seq)).toEqual([1, 3]);
      expect(replay.skipped).toEqual([2, 3]);
      expect(logs.lines.map((line) => line.annotations)).toMatchObject([
        { path: "C:/threads/t/events.jsonl", line: 2 },
        { path: "C:/threads/t/events.jsonl", line: 3 },
      ]);
    }),
);

effectTest(
  "meta.json decodes the record writeMeta writes and fills what older builds omitted",
  () =>
    Effect.gen(function* () {
      const old = {
        id: "t",
        harness: "codex",
        title: "Old",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        modelId: null,
        acpSessionId: null,
        models: [],
        head: { garbage: true },
      };
      const meta = yield* decodeThreadMeta(JSON.stringify(old), () => "Codex");
      expect(meta).toMatchObject({
        providerId: "codex",
        providerName: "Codex",
        lifecycle: emptyThreadLifecycle(),
        head: { targets: [], revision: 0 },
        tabs: [],
        traits: [],
        traitValues: {},
        forkOf: null,
        promptCapabilities: null,
      });
      const malformed = yield* Effect.exit(
        decodeThreadMeta(JSON.stringify({ ...old, lifecycle: { status: "gone" } }), () => "Codex"),
      );
      expect(Exit.isFailure(malformed)).toBe(true);
      expect(String(malformed)).toContain("lifecycle");
      expect(Schema.is(ThreadMetaFile)({ ...old, harness: "gemini" })).toBe(false);
    }),
);
