import { expect, test, vi } from "vite-plus/test";
import { publicationSource } from "./publication-source";
import { z } from "zod";
import { Publications } from "../../../host/src/reads/publications.ts";
import { leaf, read, type InputPort } from "@pe/host-internal/reads/evaluator";
import type { Readings } from "./resource-stream";
import type { ReadingContext } from "@pe/web-kernel/shell/source-contract";

const stream = vi.hoisted(
  (): {
    listener?: Parameters<Readings["subscribe"]>[1];
    subscribe?: Readings["subscribe"];
  } => ({}),
);
vi.mock("./resource-stream", () => ({
  peReadings: {
    subscribe: (...args: Parameters<Readings["subscribe"]>) => {
      if (stream.subscribe) return stream.subscribe(...args);
      stream.listener = args[1];
      return () => {};
    },
  },
}));

test("the Open route subscribes without specifying what the host watches", () => {
  const route = "open";
  const target = { kind: "host" } as const;
  const generation = 0;
  const ctx: ReadingContext = {
    target,
    workKey: null,
    workRevision: null,
    page: {},
    work: null,
    attempt: { target, workKey: null, generation },
    historyPose: { instance: "tab", route, page: {}, href: `/${route}` },
    publication: { subscription: "tab-read", generation },
    trigger: { kind: "demand" },
    args: {},
    inputs: {},
    signal: new AbortController().signal,
  };
  const subscribe = vi.fn<Readings["subscribe"]>(() => () => {});
  stream.subscribe = subscribe;
  const source = publicationSource({
    read: async () => ({
      generation,
      version: 1,
      state: "superseded",
      value: null,
    }),
  });
  const close = source.open(ctx, () => {});
  try {
    expect(subscribe.mock.calls[0]?.[0]).toEqual({
      kind: "publication",
      subscription: "tab-read",
      generation,
    });
  } finally {
    if (typeof close === "function") close();
    stream.subscribe = undefined;
  }
});

test("a document-mark race retains the last Value and retries even without another event", async () => {
  const publications = new Publications();
  const mark = leaf("document-mark", z.number(), z.number());
  const definition = read("race-probe", {
    input: z.number(),
    output: z.number(),
    run: (ctx, value) => ctx.read(mark, value),
  });
  let reads = 0;
  let revision = 0;
  const port: InputPort = {
    evaluation: "race",
    origin: {},
    revision: () => revision,
    take: async () => (reads === 2 ? ++revision : revision),
  };
  const frames: string[] = [];
  stream.subscribe = (request, accept) => {
    if (request.kind !== "publication") throw Error("Expected publication holder");
    const send = (value: unknown) => accept({ kind: "snapshot", key: "race", value });
    const close = publications.observe(request.subscription, send);
    send({ generation: 0, state: "absent" });
    return close;
  };
  const source = publicationSource({
    read: async (_ctx, { subscription, generation }, release) => {
      if (release) publications.release(subscription, generation);
      else reads++;
      return publications.publish(subscription, generation, definition, 1, port);
    },
  });
  const stop = source.open({ signal: new AbortController().signal } as never, (frame) =>
    frames.push(frame.kind),
  );
  try {
    await expect.poll(() => frames.at(-1)).toBe("complete");
    publications.invalidate((trace) => trace.name === mark.name);
    await expect
      .poll(() => frames)
      .toEqual(["complete", "document-changed", "document-changed", "complete"]);
    expect(reads).toBe(3);
  } finally {
    if (typeof stop === "function") stop();
    stream.subscribe = undefined;
  }
});

// The host re-evaluates a raced read itself (host tests: resource-content-http), so its refusal lasts.
test("a refusal with nothing retained is shown once with the host's reason; the source does not re-read", async () => {
  const refused = {
    generation: 0,
    version: 0,
    state: "refresh-needed",
    value: null,
    reason: "The machine input changed while this was being read.",
  };
  const frames: { kind: string; error?: unknown }[] = [];
  let reads = 0;
  const source = publicationSource({
    read: async (_ctx, _publication, release) => {
      if (!release) reads++;
      return refused;
    },
  });
  // A history point opens no event stream, so the source is driven by its reads alone.
  const stop = source.open(
    { signal: new AbortController().signal, historyPoint: {} } as never,
    (frame) => frames.push(frame as never),
  ) as () => void;
  await expect.poll(() => frames.at(-1)).toEqual({ kind: "failure", error: refused.reason });
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(reads).toBe(1);
  stop();
});

test("D37 an overlapping reload refused at capacity recovers when the old connection closes", async () => {
  const publications = new Publications(1);
  const definition = read("reload-probe", {
    input: z.number(),
    output: z.number(),
    run: (_ctx, value) => value,
  });
  const port: InputPort = {
    evaluation: "reload",
    origin: {},
    revision: () => 0,
    take: async () => null,
  };
  const disconnectOld = publications.observe("old-page", () => {});
  await publications.publish("old-page", 0, definition, 1, port);
  stream.subscribe = (request, accept) => {
    if (request.kind !== "publication") throw Error("Expected publication holder");
    const release = publications.observe(request.subscription, (publication) =>
      accept({ kind: "snapshot", key: "reload", value: publication }),
    );
    accept({ kind: "snapshot", key: "reload", value: { generation: 0, state: "absent" } });
    return release;
  };
  const frames: { kind: string }[] = [];
  let attempts = 0;
  const source = publicationSource({
    read: async (_ctx, publication, release) => {
      if (release) publications.release(publication.subscription, publication.generation);
      else attempts++;
      return publications.publish(
        publication.subscription,
        publication.generation,
        definition,
        1,
        port,
      );
    },
  });
  const stop = source.open(
    {
      signal: new AbortController().signal,
      publication: { subscription: "new-page", generation: 0 },
    } as never,
    (frame) => frames.push(frame),
  ) as () => void;
  try {
    await expect.poll(() => frames.at(-1)?.kind).toBe("failure");
    expect(attempts).toBe(1);
    disconnectOld();
    await expect.poll(() => frames.at(-1)?.kind).toBe("complete");
    expect(attempts).toBe(2);
    expect(Object.keys(publications.history())).toEqual(["new-page"]);
  } finally {
    stop();
    disconnectOld();
    stream.subscribe = undefined;
  }
});

// A host restart under a live tab: the stream reconnects and the new host, holding no slot, answers
// the subscription `absent` (builtin-inputs.ts). The drawn value is no longer anyone's publication.
test("a live publication answered `absent` goes stale and is re-read, never kept current", async () => {
  const value = { evaluation: "e1", coverage: { refused: [], unknown: [] } };
  const frames: { kind: string }[] = [];
  let reads = 0;
  const source = publicationSource({
    read: async (_ctx, _publication, release) => {
      if (!release) reads++;
      return { generation: 0, version: reads, state: "current", value };
    },
  });
  const stop = source.open({ signal: new AbortController().signal } as never, (frame) =>
    frames.push(frame as never),
  ) as () => void;
  await expect.poll(() => stream.listener).toBeDefined();
  expect(reads).toBe(0);
  stream.listener!({
    kind: "snapshot",
    key: "k",
    value: { generation: 0, version: 0, state: "absent" },
  });
  await expect.poll(() => frames.map((frame) => frame.kind)).toEqual(["complete"]);
  stream.listener!({
    kind: "snapshot",
    key: "k",
    value: { generation: 0, version: 0, state: "absent" },
  });
  await expect
    .poll(() => frames.map((frame) => frame.kind))
    .toEqual(["complete", "stale", "complete"]);
  expect(reads).toBe(2);
  stop();
});

test("a refusal holds no value, so its `absent` answer is no news: one read", async () => {
  const frames: { kind: string }[] = [];
  let reads = 0;
  stream.listener = undefined;
  const source = publicationSource({
    read: async (_ctx, _publication, release) => {
      if (!release) reads++;
      return {
        generation: 0,
        version: 0,
        state: "refresh-needed",
        value: null,
        reason: "Refused.",
      };
    },
  });
  const stop = source.open({ signal: new AbortController().signal } as never, (frame) =>
    frames.push(frame as never),
  ) as () => void;
  await expect.poll(() => stream.listener).toBeDefined();
  stream.listener!({
    kind: "snapshot",
    key: "k",
    value: { generation: 0, version: 0, state: "absent" },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect([reads, frames.map((frame) => frame.kind)]).toEqual([1, ["failure"]]);
  stop();
});
