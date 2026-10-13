import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture.ts";
import { expect, test, vi } from "vite-plus/test";
import { address } from "@pe/agent-contracts";

import { chatManifest } from "./manifest";

const DOCUMENT = address("C:/Review/Operations Demo.rvt");
const reading = (observation: unknown) => ({ state: "ready", observation }) as never;
const machine = reading(
  machineFixture([
    {
      session: "pe.app-26",
      documents: [
        {
          openId: "one",
          title: "Operations Demo.rvt",
          address: DOCUMENT,
          isFamilyDocument: false,
          isActive: true,
        },
      ],
    },
  ]),
);
const head = (session: string) =>
  reading({ defaultTarget: { kind: "named", session, address: DOCUMENT }, revision: 1 });

/** What `useRoute` hands `ready`: the route's own readings, read at the moment of the question. */
const ready = (readings: Record<string, unknown>, deps: object = {}, text = "hi") =>
  chatManifest({ thread: "t1", ready: true, send: vi.fn(), ...deps }).actions!.send!.ready(
    { readings } as never,
    { text } as never,
  );

test("send refuses while the bound target is closed, and runs on a live or absent one", () => {
  const closed = "Its document is closed: choose a live document or clear the target";
  expect(ready({ head: head("pe.app-25"), machine })).toBe(closed);
  expect(ready({ head: head("pe.app-26"), machine })).toBeNull();
  expect(ready({ head: reading({ defaultTarget: null, revision: 0 }), machine })).toBeNull();
  // An inventory still being read proves nothing closed.
  expect(ready({ head: head("pe.app-25"), machine: { state: "loading" } })).toBeNull();
  // A draft's target is held beside the workbench until its first send creates the thread.
  const draft = {
    thread: "",
    draftTarget: { kind: "named", session: "pe.app-25", address: DOCUMENT },
  };
  expect(ready({ head: reading(undefined), machine }, draft)).toBe(closed);
});

test("send runs while Pea answers (the host interrupts), and Stop runs only then", () => {
  const live = { head: head("pe.app-26"), machine };
  expect(ready(live, { running: true })).toBeNull();
  const route = (running: boolean) =>
    chatManifest({ thread: "t1", ready: true, running, cancel: vi.fn() }).actions!;
  expect(route(true).send!.label).toBe("send");
  expect(route(true).stop!.ready({ readings: live } as never, undefined as never)).toBeNull();
  expect(route(false).stop!.ready({ readings: live } as never, undefined as never)).toBe(
    "Nothing is running",
  );
});
