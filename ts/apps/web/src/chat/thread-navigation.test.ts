import { expect, test } from "vite-plus/test";
import {
  address,
  type HarnessThreadSummary,
  type TargetInventory,
  emptyThreadHead,
} from "@pe/agent-contracts";
import { emptyChatState } from "#/workbench/chat-state";
import {
  demoThreads,
  activityWord,
  wokeFromSnooze,
  isUnread,
  navigationTargetKey,
  readThreadTarget,
  relativeThreadAge,
  shelfOf,
  oneThreadRefusal,
  targetFacets,
  threadVerbs,
  visibleThreads,
  threadSearchText,
} from "./thread-navigation";

const ALL = { provider: "*", state: "*", unread: false } as const;

test("full and partial immutable IDs remain searchable after a title changes", () => {
  const id = "019c6e27-e55b-73d1-87d8-4e01f1f75043";
  const threads = demoThreads({ ...emptyChatState(), id, title: "Renamed title" });
  const find = (query: string) =>
    visibleThreads(threads, { query, filter: "all", target: "*", ...ALL }).map(
      (thread) => thread.id,
    );
  expect(find(id)).toEqual([id]);
  expect(find("E55B-73D1")).toEqual([id]);
  expect(find("Renamed title")).toEqual([id]);
  expect(find("no-such-thread-id")).toEqual([]);
  expect(threadSearchText(threads[0]!)).toContain(id);
});

test("provider, state and the unread toggle narrow the roster and compose", () => {
  const threads = demoThreads({ ...emptyChatState(), id: "open", title: "Open" });
  const ids = (
    provider: string,
    state: Parameters<typeof visibleThreads>[1]["state"],
    unread = false,
  ) =>
    visibleThreads(threads, { query: "", filter: "all", target: "*", provider, state, unread })
      .map((thread) => thread.id)
      .sort();
  expect(ids("codex", "*")).toEqual(["fixture-running"]);
  expect(ids("*", "working")).toEqual(["fixture-running"]);
  expect(ids("*", "waiting")).toEqual(["open"]);
  expect(ids("*", "failed")).toEqual(["fixture-family"]);
  expect(ids("*", "idle")).toEqual([
    "fixture-ended",
    "fixture-local",
    "fixture-settled",
    "fixture-snoozed",
  ]);
  expect(ids("codex", "failed")).toEqual([]);
  expect(ids("*", "*", true)).toEqual(["fixture-family", "fixture-running", "open"]);
  expect(ids("*", "failed", true)).toEqual(["fixture-family"]);
  expect(ids("codex", "*", true)).toEqual(["fixture-running"]);
  expect(ids("*", "idle", true)).toEqual([]);
});

test("wake marks require elapsed snooze or new activity, not a manual reopen", () => {
  const now = Date.now();
  const thread = demoThreads({ ...emptyChatState(), id: "wake" })[0]!;
  const snoozed = {
    ...thread,
    lifecycle: {
      ...thread.lifecycle,
      snoozedUntil: new Date(now + 60_000).toISOString(),
      snoozedSeq: thread.activity.lastSeq,
    },
  };
  const reopened = { ...snoozed, lifecycle: { ...snoozed.lifecycle, snoozedUntil: null } };
  expect(wokeFromSnooze(snoozed, reopened, now)).toBe(false);
  expect(wokeFromSnooze(snoozed, reopened, now + 60_000)).toBe(true);
  expect(
    wokeFromSnooze(
      snoozed,
      { ...reopened, activity: { ...reopened.activity, lastSeq: reopened.activity.lastSeq + 1 } },
      now,
    ),
  ).toBe(true);
});

test("waiting activity remains visible independently of the unread mark", () => {
  const thread = demoThreads({ ...emptyChatState(), id: "waiting" })[0]!;
  const waiting = {
    ...thread,
    activity: { ...thread.activity, state: "waiting" as const, pending: 0 },
  };
  expect(activityWord(waiting)).toBe("Waiting for you");
  expect(isUnread(waiting)).toBe(true);
  expect(activityWord({ ...waiting, lifecycle: { ...waiting.lifecycle, readSeq: 2 } })).toBe(
    "Waiting for you",
  );
});

test("shelves derive overlays without merging targets or provider identities", () => {
  const threads = demoThreads({ ...emptyChatState(), id: "selected", title: "Selected" });
  expect(threads.map((thread) => shelfOf(thread))).toEqual([
    "pinned",
    "active",
    "active",
    "active",
    "snoozed",
    "settled",
    "archived",
    "active",
  ]);
  const exact = { kind: "open" as const, ref: { session: "a", openId: "one" } };
  const a = { ...threads[0]!, head: { ...emptyThreadHead, defaultTarget: exact, revision: 1 } };
  const b = {
    ...a,
    id: "other",
    head: {
      ...emptyThreadHead,
      defaultTarget: { ...exact, ref: { session: "a", openId: "two" } },
      revision: 1,
    },
  };
  expect(
    visibleThreads([a, b], {
      query: "",
      filter: "all",
      target: navigationTargetKey(exact),
      ...ALL,
    }).map((thread) => thread.id),
  ).toEqual([a.id]);
  expect(
    visibleThreads(threads, { query: "Codex", filter: "all", target: "*", ...ALL }).map(
      (thread) => thread.id,
    ),
  ).toEqual(["fixture-running"]);
  expect(
    visibleThreads(threads, { query: "", filter: "archived", target: "*", ...ALL }),
  ).toHaveLength(1);
});

test("many-thread verbs apply to the threads that can take them and refuse only when none can", () => {
  const [open, running, local, , snoozed, settled] = demoThreads({
    ...emptyChatState(),
    id: "open",
  });
  const byId = (threads: HarnessThreadSummary[], id: string) =>
    threadVerbs(threads).find((verb) => verb.id === id)!;
  const ids = (verb: ReturnType<typeof byId>) => verb.targets.map((thread) => thread.id);

  // Two threads, one working: settle and archive skip it, snooze/unread take both or the quiet one.
  const pair = [running!, local!];
  expect(byId(pair, "settle")).toMatchObject({
    label: "Settle",
    refusal: undefined,
    note: "1 of 2",
  });
  expect(ids(byId(pair, "settle"))).toEqual(["fixture-local"]);
  expect(ids(byId(pair, "snooze"))).toEqual(["fixture-running", "fixture-local"]);
  expect(byId(pair, "snooze").label).toBe("Snooze");
  // Unread: one is unread, one read -> Mark unread targets the read one.
  expect(byId(pair, "unread").label).toBe("Mark unread");
  expect(ids(byId(pair, "unread"))).toEqual(["fixture-local"]);

  // None can: the verb is listed with the reason, never absent.
  const busy = [running!, open!];
  expect(byId(busy, "settle").refusal).toBe(
    "none of 2 can: finish the work and answer its asks first",
  );
  expect(byId(busy, "settle").targets).toEqual([]);
  // One thread keeps the plain reason.
  expect(byId([running!], "settle").refusal).toBe("finish the work and answer its asks first");

  // All settled -> Reopen; all snoozed -> Wake now; every selected unread -> read is the other way.
  expect(byId([settled!, settled!], "settle").label).toBe("Reopen");
  expect(byId([snoozed!, snoozed!], "snooze").label).toBe("Wake now");
  expect(byId([local!], "unread").label).toBe("Mark unread");

  // One-thread verbs refuse many with the count and are silent for one.
  expect(oneThreadRefusal("Rename", 3)).toBe("Rename works on one thread; 3 are selected");
  expect(oneThreadRefusal("Rename", 1)).toBeUndefined();
});

test("relative age gives useful same-day values and handles absent timestamps", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");
  expect(relativeThreadAge("2026-10-11T11:48:00.000Z", now)).toBe("12m");
  expect(relativeThreadAge("2026-10-11T09:00:00.000Z", now)).toBe("3h");
  expect(relativeThreadAge("", now)).toBe("—");
});

test("unread comes from actual activity or explicit mark, never generic lastSeq/title", () => {
  const thread = demoThreads({ ...emptyChatState(), id: "x" })[0]!;
  expect(isUnread({ ...thread, lastSeq: 99, lifecycle: { ...thread.lifecycle, readSeq: 2 } })).toBe(
    false,
  );
  expect(
    isUnread({ ...thread, lifecycle: { ...thread.lifecycle, readSeq: 2, explicitUnread: true } }),
  ).toBe(true);
  const named = {
    ...thread,
    head: {
      ...emptyThreadHead,
      defaultTarget: { kind: "named" as const, session: "s", address: address("C:/Model.rvt") },
      revision: 1,
    },
  };
  expect(
    visibleThreads([named], { query: "Model.rvt", filter: "all", target: "*", ...ALL }),
  ).toHaveLength(1);
});

// The live inventory holds one session with one open document; every other saved target is closed.
const INVENTORY: TargetInventory = {
  kind: "ready",
  sessions: {
    "pe.app-26": {
      kind: "ready",
      values: [
        { openId: "one", address: address("C:/Review/Operations Demo.rvt"), kind: "project" },
      ],
    },
  },
};

test("a closed target is read from the inventory, never offered, and collapses to one filter option", () => {
  const [open, , local, family, , , , ended] = demoThreads({ ...emptyChatState(), id: "open" }).map(
    (thread) => readThreadTarget(thread, INVENTORY),
  );
  // The document is open; the family is not open in a live session; the session itself is gone.
  expect(open!.targetClosed).toBeUndefined();
  expect(open!.head.displayLabel).toBe("Operations Demo.rvt");
  expect(local!.targetClosed).toBeUndefined();
  expect(family!.targetClosed).toBe("document");
  expect(family!.head.displayLabel).toBe("Closed document");
  expect(ended!.targetClosed).toBe("session");
  expect(ended!.head.displayLabel).toBe("Closed session");
  // An inventory still being read proves nothing closed.
  expect(readThreadTarget(ended!, { kind: "checking" }).targetClosed).toBe("session");
  expect(
    readThreadTarget({ ...ended!, targetClosed: undefined }, { kind: "checking" }).targetClosed,
  ).toBeUndefined();

  // One verb rule for one or many: a closed target refuses "New thread on this target" with why.
  const newTarget = (threads: (typeof open)[]) =>
    threadVerbs(threads as never).find((verb) => verb.id === "new-target")!;
  expect(newTarget([open!])).toMatchObject({
    refusal: undefined,
    label: "New thread on this target",
  });
  expect(newTarget([ended!]).refusal).toBe("Its session is closed");
  expect(newTarget([family!]).refusal).toBe("Its document is closed");
  expect(newTarget([ended!, family!]).refusal).toBe("none of 2 can: its target is closed");
  expect(newTarget([open!, ended!]).targets.map((thread) => thread.id)).toEqual([open!.id]);

  // The filter lists live targets one by one and every closed target as the one "Closed".
  const threads = [open!, local!, family!, ended!];
  const facets = targetFacets(threads);
  expect(facets.map((facet) => facet.label)).toEqual([
    "Operations Demo.rvt",
    "Untargeted",
    "Closed",
  ]);
  const closed = visibleThreads(threads, { query: "", filter: "all", target: "closed", ...ALL });
  expect(closed.map((thread) => thread.id).sort()).toEqual([ended!.id, family!.id].sort());
  const live = visibleThreads(threads, {
    query: "",
    filter: "all",
    target: facets[0]!.key,
    ...ALL,
  });
  expect(live.map((thread) => thread.id)).toEqual([open!.id]);
});
