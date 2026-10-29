// @vitest-environment jsdom
/** Accepted-delta transport, browser end: real PeReadings over a stand-in EventSource. */
import { expect, test } from "vite-plus/test";
import { readingKey, type WorkKey, type WorkWriteAck } from "@pe/agent-contracts";
import { PeReadings } from "#/readings";
import { subscribeAcceptedDeltas } from "./host";

const key: WorkKey = { binding: "host", route: "test-route", target: null };
const subject = readingKey({ kind: "work-acks", work: key });

const ack = (revision: number, over: Partial<WorkWriteAck> = {}): WorkWriteAck => ({
  key,
  kind: "apply",
  by: "human",
  press: `press-${revision}`,
  base: revision - 1,
  revision,
  patches: [{ path: ["values", "a"], value: revision }],
  inverse: [{ path: ["values", "a"], value: revision - 1 }],
  undoable: true,
  ...over,
});

function setup() {
  const sources: { onopen?: () => void; onmessage?: (e: { data: string }) => void }[] = [];
  const readings = new PeReadings(
    () => "http://host/pe/resources",
    () => {
      const source = { close() {} } as (typeof sources)[number] & { close(): void };
      sources.push(source);
      return source as unknown as EventSource;
    },
    (deliver) => {
      deliver();
      return () => {};
    },
  );
  const acks: WorkWriteAck[] = [];
  let gaps = 0;
  const release = subscribeAcceptedDeltas(
    key,
    (a) => acks.push(a),
    () => gaps++,
    readings,
  );
  const send = async (frame: object) => {
    await Promise.resolve();
    sources.at(-1)!.onopen?.();
    sources.at(-1)!.onmessage!({ data: JSON.stringify({ key: subject, ...frame }) });
  };
  return { acks, gaps: () => gaps, send, release, readings };
}

test("a Pea write arrives with the host's stamps, distinguishable from a human press", async () => {
  const t = setup();
  await t.send({ kind: "event", value: ack(1) });
  await t.send({ kind: "event", value: ack(2, { by: "pea", press: null }) });
  expect(t.acks.map(({ by, press, revision }) => ({ by, press, revision }))).toEqual([
    { by: "human", press: "press-1", revision: 1 },
    { by: "pea", press: null, revision: 2 },
  ]);
  expect(t.acks[1]).toMatchObject({
    patches: [{ path: ["values", "a"], value: 2 }],
    inverse: [{ path: ["values", "a"], value: 1 }],
  });
  expect(t.gaps()).toBe(0);
  t.release();
  t.readings.close();
});

test("a replayed window is deduplicated and a revision jump or transport gap is reported", async () => {
  const t = setup();
  await t.send({ kind: "event", value: ack(1) });
  await t.send({ kind: "event", value: ack(2) });
  await t.send({ kind: "event", value: ack(1) }); // reconnect replays the retained window
  await t.send({ kind: "event", value: ack(2) });
  expect(t.acks.map((a) => a.revision)).toEqual([1, 2]);
  expect(t.gaps()).toBe(0);
  await t.send({ kind: "event", value: ack(5, { base: 4 }) }); // 3 and 4 fell out of the window
  expect(t.acks.map((a) => a.revision)).toEqual([1, 2, 5]);
  expect(t.gaps()).toBe(1);
  await t.send({ kind: "gap", dropped: 3 });
  expect(t.gaps()).toBe(2);
  await t.send({ kind: "event", value: { revision: "not an ack" } });
  expect(t.gaps()).toBe(3);
  t.release();
  t.readings.close();
});
