import { receiptGoldenEnvelope } from "../../../packages/agent-contracts/tests/receipt-fixture.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";
import { createReceiptExport } from "../src/receipt-export.ts";

const stamp = { ...receiptGoldenEnvelope.stamp!, component: "host" as const };
const report = {
  surface: "pe_find",
  expected: "a row for the family op",
  observed: "an empty list",
  workaround: "read the skill",
  refs: ["req-1"],
};
const context = { turnId: "turn-1", provider: "claude", model: "sonnet" };

function fixture(send: (event: unknown) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "pe-agent-feedback-"));
  const journal = new ActionJournal(join(dir, "journal.json"), () => stamp);
  const exporter = createReceiptExport({
    journal,
    root: dir,
    stamps: { host: stamp, web: null },
    send: async (event) => send(event),
  });
  return {
    dir,
    exporter,
    journal,
    async close() {
      await exporter.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const rows = (dir: string) =>
  readFileSync(join(dir, "agent-feedback.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

test("a report writes one JSONL row whose host stamps the report cannot override", async () => {
  const f = fixture(async () => {});
  try {
    const hostile = { ...report, commit: "forged", installId: "forged", threadId: "forged" };
    const { feedbackId } = await f.exporter.submitAgentFeedback(
      hostile as typeof report,
      "pea",
      "thread-1",
      context,
    );
    const [row, ...rest] = rows(f.dir);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      ...report,
      feedbackId,
      commit: stamp.commit,
      version: stamp.version,
      installId: stamp.installId,
      callerKind: "pea",
      threadId: "thread-1",
      turnId: "turn-1",
      harnessProvider: "claude",
      harnessModel: "sonnet",
    });
  } finally {
    await f.close();
  }
});

test("the export event carries the content and the stamps, with opaque thread and turn ids", async () => {
  const sent: { event: string; distinctId: string; properties: Record<string, unknown> }[] = [];
  const f = fixture(async (event) => void sent.push(event as (typeof sent)[number]));
  try {
    const { feedbackId } = await f.exporter.submitAgentFeedback(report, "pea", "thread-1", context);
    await f.exporter.close();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ event: "agent_feedback", distinctId: stamp.installId });
    expect(sent[0]!.properties).toMatchObject({
      ...report,
      feedback_id: feedbackId,
      caller_kind: "pea",
      harness_provider: "claude",
      harness_model: "sonnet",
      install_id: stamp.installId,
      commit: stamp.commit,
      version: stamp.version,
      $process_person_profile: false,
    });
    expect(sent[0]!.properties.thread_id).toBe(await f.journal.opaqueId("thread", "thread-1"));
    expect(sent[0]!.properties.turn_id).toBe(await f.journal.opaqueId("turn", "thread-1:turn-1"));
    expect(JSON.stringify(sent[0])).not.toContain('thread-1"');
  } finally {
    await f.close();
  }
});

test("export failure still returns a feedbackId and keeps the local row", async () => {
  const f = fixture(async () => {
    throw Error("posthog down");
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { feedbackId } = await f.exporter.submitAgentFeedback(report, "human", null, null);
    expect(feedbackId).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows(f.dir)[0]).toMatchObject({ feedbackId, callerKind: "human", threadId: null });
  } finally {
    console.warn = warn;
    await f.close();
  }
});

test("an undelivered report is replayed at the next start under its feedbackId, and only once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-agent-feedback-replay-"));
  const sent: { uuid?: string; event: string; properties: Record<string, unknown> }[] = [];
  const start = (send: (event: (typeof sent)[number]) => Promise<void>) =>
    createReceiptExport({
      journal: new ActionJournal(join(dir, "journal.json"), () => stamp),
      root: dir,
      stamps: { host: stamp, web: null },
      send: async (event) => send(event),
    });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const down = start(async () => {
      throw Error("posthog down");
    });
    const { feedbackId } = await down.submitAgentFeedback(report, "pea", "thread-1", context);
    await down.close();
    const up = start(async (event) => void sent.push(event));
    await up.close();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ uuid: feedbackId, event: "agent_feedback" });
    expect(sent[0]!.properties).toMatchObject({ ...report, feedback_id: feedbackId });
    await start(async (event) => void sent.push(event)).close();
    expect(sent).toHaveLength(1);
  } finally {
    console.warn = warn;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reports share the 64-pending export limit and every one stays kept locally", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-agent-feedback-limit-"));
  let started = 0;
  const exporter = createReceiptExport({
    journal: new ActionJournal(join(dir, "journal.json"), () => stamp),
    root: dir,
    stamps: { host: stamp, web: null },
    deadlineMs: 1000,
    send: (_event, signal) =>
      new Promise((_, reject) => {
        started++;
        signal.addEventListener("abort", () => reject(Error("deadline")));
      }),
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < 65; i++) await exporter.submitAgentFeedback(report, "pea", null, null);
    await exporter.close();
    expect(started).toBe(64);
    expect(rows(dir)).toHaveLength(65);
  } finally {
    console.warn = warn;
    rmSync(dir, { recursive: true, force: true });
  }
});
