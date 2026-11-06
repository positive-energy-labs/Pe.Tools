import { expect, test } from "vite-plus/test";
import { READING_MAX_KEYS, type AcceptedReading, type RecordingAcknowledgements } from "@pe/agent-contracts";
import { identityCodecs } from "../../agent-contracts/src/route-kernel-codecs.ts";
import { resourceResponse, updateResourceSubscriptions, type ResourceObserver, type ResourceAcceptance } from "./resource-stream.ts";

const encoded = identityCodecs.document.encode({ document: "C:/Models/acceptance.rvt" });
if (!encoded.ok) throw Error("Invalid fixture document");
const reading: AcceptedReading = {
  document: encoded.value,
  consumer: { instance: "pane", reading: "sheet", argsHash: "same-args" },
  bodyReceipts: ["host-verified-by-policy"],
};
async function connection(accept: ResourceAcceptance["accept"]) {
  const observe: ResourceObserver = () => () => {};
  const response = resourceResponse(new Request("http://host/pe/resources?connection=mounted"),
    observe, undefined, observe, undefined, { audience: "browser", accept });
  const stream = response.body!.getReader();
  await stream.read();
  return {
    close: () => stream.cancel(),
    subscribe: () => updateResourceSubscriptions(new Request("http://host/pe/resource-subscriptions?connection=mounted", {
      method: "POST", body: JSON.stringify({ add: [{ kind: "machine" }], remove: [] }),
    }), observe, "browser"),
    ack: (ack: Partial<RecordingAcknowledgements>) => updateResourceSubscriptions(
      new Request("http://host/pe/resource-subscriptions?connection=mounted", {
        method: "POST", body: JSON.stringify({ add: [], remove: [], ...ack }),
      }), observe, "browser"),
  };
}

test("a mounted reading can return with the same args and retained body after unmount", async () => {
  let accepted = 0;
  const owner = await connection(async () => { accepted++; });
  try {
    expect((await owner.ack({ accepted: [reading] })).status).toBe(200);
    expect((await owner.ack({ unmounted: [reading.consumer] })).status).toBe(200);
    expect((await owner.ack({ accepted: [reading] })).status).toBe(200);
    expect(accepted).toBe(2);
  } finally { await owner.close(); }
});

test("acceptance slot overflow refuses without retiring live subscription admission", async () => {
  const owner = await connection(async () => {});
  try {
    for (let i = 0; i < READING_MAX_KEYS; i++) {
      const slot = { ...reading, consumer: { ...reading.consumer, instance: `pane-${i}` } };
      expect((await owner.ack({ accepted: [slot] })).status).toBe(200);
    }
    const extra = { ...reading, consumer: { ...reading.consumer, instance: "overflow" } };
    expect((await owner.ack({ accepted: [extra] })).status).toBe(400);
    expect((await owner.subscribe()).status).toBe(200);
  } finally { await owner.close(); }
});

test("unmount fences an in-flight acceptance without permanently retiring its identity", async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0, accepted = 0;
  const owner = await connection(async (_readings, active) => {
    if (++calls === 1) { enter(); await released; }
    if (active()) accepted++;
  });
  try {
    const pending = owner.ack({ accepted: [reading] });
    await entered;
    expect((await owner.ack({ unmounted: [reading.consumer] })).status).toBe(200);
    release();
    expect((await pending).status).toBe(400);
    expect(accepted).toBe(0);
    expect((await owner.ack({ accepted: [reading] })).status).toBe(200);
    expect(accepted).toBe(1);
  } finally { release(); await owner.close(); }
});
