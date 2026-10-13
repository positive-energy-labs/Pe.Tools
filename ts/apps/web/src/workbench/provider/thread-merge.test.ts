import { expect, test } from "vite-plus/test";
import { emptyChatState } from "../chat-state";
import { mergeThreadRoster, mergeThreadSummary } from "./thread-merge";

test("delayed mutations cannot rewind an independently streamed target, lifecycle or activity", () => {
  const original = { ...emptyChatState(), id: "t", lastSeq: 2, updatedAt: "2026-10-11" };
  const live = {
    ...original,
    lastSeq: 4,
    head: {
      ...original.head,
      defaultTarget: { kind: "open" as const, ref: { session: "exact", openId: "new" } },
      revision: 2,
    },
    lifecycle: { ...original.lifecycle, revision: 3, explicitUnread: true, readSeq: 3 },
    activity: { ...original.activity, lastSeq: 4, state: "waiting" as const, pending: 1 },
  };
  const delayed = {
    ...original,
    title: "Older",
    head: { ...original.head, revision: 1 },
    lifecycle: { ...original.lifecycle, revision: 2, readSeq: 2 },
    activity: { ...original.activity, lastSeq: 2 },
  };
  const merged = mergeThreadSummary(live, delayed);
  expect(merged).toMatchObject({
    head: live.head,
    lifecycle: live.lifecycle,
    activity: live.activity,
    lastSeq: 4,
  });
  expect(mergeThreadRoster([live], [delayed])[0]).toEqual(merged);
});

test("read watermarks never regress even when the same lifecycle revision arrives later", () => {
  const thread = {
    ...emptyChatState(),
    id: "t",
    lifecycle: { ...emptyChatState().lifecycle, revision: 2, readSeq: 20 },
  };
  expect(
    mergeThreadSummary(thread, { ...thread, lifecycle: { ...thread.lifecycle, readSeq: 3 } })
      .lifecycle.readSeq,
  ).toBe(20);
});
