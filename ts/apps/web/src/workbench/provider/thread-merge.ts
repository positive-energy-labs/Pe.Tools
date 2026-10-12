import type { HarnessThreadSummary } from "@pe/agent-contracts";

/** Independent owners advance independently: a delayed mutation cannot rewind a streamed head. */
export function mergeThreadSummary(
  current: HarnessThreadSummary,
  incoming: HarnessThreadSummary,
): HarnessThreadSummary {
  const newest = incoming.lastSeq >= current.lastSeq ? incoming : current;
  const lifecycle =
    incoming.lifecycle.revision >= current.lifecycle.revision
      ? incoming.lifecycle
      : current.lifecycle;
  return {
    ...newest,
    head: incoming.head.revision >= current.head.revision ? incoming.head : current.head,
    lifecycle: {
      ...lifecycle,
      readSeq: Math.max(current.lifecycle.readSeq, incoming.lifecycle.readSeq),
    },
    activity:
      incoming.activity.lastSeq >= current.activity.lastSeq ? incoming.activity : current.activity,
    lastSeq: Math.max(current.lastSeq, incoming.lastSeq),
    updatedAt: incoming.updatedAt >= current.updatedAt ? incoming.updatedAt : current.updatedAt,
  };
}
export function mergeThreadRoster(
  current: HarnessThreadSummary[],
  incoming: HarnessThreadSummary[],
) {
  const previous = new Map(current.map((thread) => [thread.id, thread]));
  return incoming.map((thread) =>
    previous.has(thread.id) ? mergeThreadSummary(previous.get(thread.id)!, thread) : thread,
  );
}
