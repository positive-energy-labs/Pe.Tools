import { expect, test } from "vite-plus/test";
import { readingKey, type ReadingFrame, type ReadingRequest } from "@pe/agent-contracts";
import { resourceResponse, type ResourceObserver } from "@pe/runtime";

const keys: ReadingRequest[] = [
  { kind: "thread", thread: "a" },
  { kind: "thread", thread: "b" },
];
const [a, b] = keys.map(readingKey) as [string, string];
function open(logFrames: number) {
  let publish!: (frame: ReadingFrame) => void;
  const observe: ResourceObserver = (_request, sink) => {
    publish = sink;
    return () => {};
  };
  const url = `http://host/pe/resources?keys=${encodeURIComponent(JSON.stringify(keys))}&after=0`;
  const response = resourceResponse(new Request(url), observe, {
    frameBytes: 1 << 20,
    worldEvents: 64,
    workAckEvents: 128,
    stallMs: 10_000,
    logFrames,
  });
  const reader = response.body!.getReader();
  const ids = async (count: number) => {
    let text = "";
    while ([...text.matchAll(/^id: (\d+)$/gm)].length < count)
      text += new TextDecoder().decode((await reader.read()).value);
    return [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
  };
  return { publish: (frame: ReadingFrame) => publish(frame), ids, reader };
}

test("log frames of every key share one lane, in id order", async () => {
  const lane = open(8);
  lane.publish({ kind: "event", key: a, value: 1, id: 1 });
  lane.publish({ kind: "event", key: b, value: 2, id: 2 });
  lane.publish({ kind: "event", key: a, value: 3, id: 3 });
  expect(await lane.ids(3)).toEqual([1, 2, 3]);
});

test("a reader that falls behind the lane loses its connection, never an event", async () => {
  const lane = open(2);
  for (let id = 1; id <= 6; id++) lane.publish({ kind: "event", key: a, value: id, id });
  const read = async () => {
    for (;;) if ((await lane.reader.read()).done) return "done";
  };
  await expect(read()).rejects.toThrow();
});
