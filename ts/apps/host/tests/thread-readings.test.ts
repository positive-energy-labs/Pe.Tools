import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  HarnessEvent,
  HarnessThreadBody,
  HarnessThreadSummary,
  ReadingFrame,
} from "@pe/agent-contracts";
import { resourceResponse, type ResourceObserver } from "@pe/runtime";
import { withInvocationContext } from "@pe/mcps/context";
import { human } from "./callers.ts";
import { HostLog } from "../src/host-log.ts";
import { createProviders } from "../src/harness/providers.ts";
import { createHarnessThreads } from "../src/harness/threads.ts";

let root = "";
let previousLocalAppData: string | undefined;
const closers: (() => Promise<unknown>)[] = [];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-thread-readings-"));
  previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  process.env.PE_HARNESS_ADAPTER_CLAUDE = join(import.meta.dirname, "fake-acp-agent.mjs");
});
afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
  delete process.env.PE_HARNESS_ADAPTER_CLAUDE;
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
  await rm(root, { recursive: true, force: true });
});

function host(limits?: { segmentBytes: number; segments: number; entryBytes: number }) {
  const log = new HostLog(join(root, "log", randomUUID()), limits);
  const threads = createHarnessThreads({
    root: join(root, "threads"),
    log,
    worldRoot: tmpdir(),
    mcpServer: () => ({ name: "pea", command: "unused", args: [], env: [] }),
    providers: createProviders({ shellPath: async () => "", probeOnStart: false }),
  });
  closers.push(threads.close);
  const observe: ResourceObserver = (request, publish, after) =>
    threads.observe(request, publish, after) ??
    (publish({ kind: "failure", key: "", error: "unowned" }), () => {});
  const call = async (method: string, path: string, body?: object) => {
    const response = await withInvocationContext({ caller: human }, () =>
      threads.fetch(
        new Request(`http://host${path}`, {
          method,
          headers: method === "GET" ? {} : { "content-type": "application/json" },
          body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
        }),
      ),
    );
    return response.json();
  };
  /** One Readings connection: frames as they arrive, with the SSE id each carried. */
  const connect = (keys: object[], after?: number) => {
    const abort = new AbortController();
    const url = `http://host/pe/resources?keys=${encodeURIComponent(JSON.stringify(keys))}${after === undefined ? "" : `&after=${after}`}`;
    const response = resourceResponse(new Request(url, { signal: abort.signal }), observe);
    const reader = response.body!.getReader();
    const frames: (ReadingFrame & { sse?: number })[] = [];
    let buffer = "";
    const next = async () => {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const id = /^id: (\d+)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (!data) continue;
          const frame = { ...JSON.parse(data), ...(id ? { sse: Number(id) } : {}) };
          frames.push(frame);
          return frame as ReadingFrame & { sse?: number };
        }
        const { value, done } = await reader.read();
        if (done) throw Error("stream ended");
        buffer += new TextDecoder().decode(value);
      }
    };
    return { abort, next, frames, response };
  };
  return { threads, log, call, connect };
}

/** The fold every client runs: apply a thread event once, in seq order; a hole is a gap. */
function follow(events: HarnessEvent[]) {
  let gaps = 0;
  return {
    events,
    get gaps() {
      return gaps;
    },
    apply(event: HarnessEvent) {
      const last = events.at(-1)?.seq ?? 0;
      if (event.seq <= last) return;
      if (event.seq !== last + 1) gaps++;
      else events.push(event);
    },
  };
}

const until = async (
  read: () => Promise<HarnessThreadBody>,
  done: (b: HarnessThreadBody) => boolean,
) => {
  for (let i = 0; i < 200; i++) {
    const body = await read();
    if (done(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error("timed out");
};
const ended = (body: HarnessThreadBody, count: number) =>
  body.events.filter((e) => e.kind === "turn_end").length === count && !body.running;

test("a reconnect from the cursor after a dropped connection yields the identical thread", async () => {
  const { call, connect } = host();
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).id as string;
  const read = () => call("GET", `/pe/threads/${id}`) as Promise<HarnessThreadBody>;
  await call("POST", `/pe/threads/${id}/prompt`, { id: randomUUID(), text: "hello" });
  await until(read, (b) => ended(b, 1));

  // A fresh connection has no history to replay: a gap, carrying the cursor to resume from.
  const key = { kind: "thread", thread: id };
  const first = connect([key]);
  const opened = await first.next();
  expect(opened).toMatchObject({ kind: "gap", dropped: null });
  let cursor = opened.sse!;
  expect(cursor).toBeGreaterThan(0);
  const state = follow([...(await read()).events]);

  await call("POST", `/pe/threads/${id}/prompt`, { id: randomUUID(), text: "one" });
  for (;;) {
    const frame = await first.next();
    cursor = frame.sse ?? cursor;
    if (frame.kind === "event") state.apply(frame.value as HarnessEvent);
    if (frame.kind === "event" && (frame.value as HarnessEvent).kind === "turn_end") break;
  }
  first.abort.abort();

  // Missed while disconnected.
  await call("POST", `/pe/threads/${id}/prompt`, { id: randomUUID(), text: "two" });
  await until(read, (b) => ended(b, 3));

  const second = connect([key], cursor);
  for (;;) {
    const frame = await second.next();
    if (frame.kind !== "event") throw Error(`expected an event, got ${frame.kind}`);
    expect(frame.sse).toBeGreaterThan(cursor);
    cursor = frame.sse!;
    state.apply(frame.value as HarnessEvent);
    if ((frame.value as HarnessEvent).kind === "turn_end") break;
  }
  second.abort.abort();
  expect(state.gaps).toBe(0);
  expect(state.events).toEqual((await read()).events);
});

test("a cursor older than retention reads as a gap, never a silent hole", async () => {
  const { call, connect } = host({ segmentBytes: 300, segments: 2, entryBytes: 64 * 1024 });
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).id as string;
  const read = () => call("GET", `/pe/threads/${id}`) as Promise<HarnessThreadBody>;
  for (let turn = 1; turn <= 3; turn++) {
    await call("POST", `/pe/threads/${id}/prompt`, { id: randomUUID(), text: `t${turn}` });
    await until(read, (b) => ended(b, turn));
  }
  const stale = connect([{ kind: "thread", thread: id }], 1);
  expect(await stale.next()).toMatchObject({ kind: "gap", dropped: null });
  stale.abort.abort();
});

test("the thread list is one snapshot Reading that follows a rename", async () => {
  const { call, connect } = host();
  const id = (await call("POST", "/pe/threads", { providerId: "claude", title: "Before" })).id;
  const list = connect([{ kind: "threads" }]);
  const titles = async () =>
    ((await list.next()) as { value: HarnessThreadSummary[] }).value.find((t) => t.id === id)
      ?.title;
  expect(await titles()).toBe("Before");
  await call("PUT", `/pe/threads/${id}`, { title: "After" });
  let title: string | undefined;
  while (title !== "After") title = await titles();
  list.abort.abort();
});
