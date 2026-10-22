// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { DIAGNOSTICS_MAX_PENDING, Diagnostics, type Post } from "./diagnostics";

const ok = () => new Response("{}", { status: 202 });
type Batch = Parameters<Post>[0];

function owner(answer: (batch: Batch) => Promise<Response>) {
  const sent: Batch[] = [];
  const post: Post = (batch) => {
    sent.push(JSON.parse(JSON.stringify(batch)) as Batch);
    return answer(batch);
  };
  return { sent, diagnostics: new Diagnostics(post) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("a caught fault leaves as its closed diagnostic body; the message stays in the tab", async () => {
  const { sent, diagnostics } = owner(async () => ok());
  diagnostics.report(
    { code: "reading.timeout", elapsedMs: 30_000, readingKind: "machine" },
    Error("C:\\Users\\someone\\secret.rvt exploded"),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.facts.map((f) => f.body)).toEqual([
    { kind: "diagnostic", code: "reading.timeout", elapsedMs: 30_000, readingKind: "machine" },
  ]);
  expect(JSON.stringify(sent)).not.toContain("secret");
  expect(diagnostics.getState()).toMatchObject({ delivery: "delivered", pending: 0 });
  expect(diagnostics.getState().recent[0]!.message).toContain("secret.rvt");
});

test("a label outside the token grammar is not sent; the code still is", async () => {
  const { sent, diagnostics } = owner(async () => ok());
  diagnostics.report({ code: "pane.failed", readingKind: "C:\\path with spaces" });
  await vi.advanceTimersByTimeAsync(0);
  expect(sent[0]!.facts[0]!.body).toEqual({ kind: "diagnostic", code: "pane.failed" });
});

test("host down: bounded buffer drops oldest, counts it, and reports the outage on return", async () => {
  let down = true;
  const { sent, diagnostics } = owner(async () => {
    if (down) throw TypeError("Failed to fetch");
    return ok();
  });
  for (let i = 0; i < DIAGNOSTICS_MAX_PENDING + 3; i++)
    diagnostics.report({ code: "stream.failed" });
  await vi.advanceTimersByTimeAsync(0);
  expect(diagnostics.getState()).toMatchObject({
    delivery: "unreachable",
    detail: "Failed to fetch",
    pending: DIAGNOSTICS_MAX_PENDING,
    dropped: 3,
  });
  down = false;
  await vi.advanceTimersByTimeAsync(2_000);
  await vi.advanceTimersByTimeAsync(10);
  const delivered = sent.filter((batch) => batch.facts.length);
  expect(delivered.at(-2)).toMatchObject({ dropped: 3 });
  expect(delivered.at(-2)!.facts).toHaveLength(DIAGNOSTICS_MAX_PENDING);
  expect(delivered.at(-1)!.facts.map((f) => f.body.code)).toEqual(["host.unreachable"]);
  expect(delivered.at(-1)!.dropped).toBe(0);
  expect(diagnostics.getState()).toMatchObject({ delivery: "delivered", pending: 0 });
});
