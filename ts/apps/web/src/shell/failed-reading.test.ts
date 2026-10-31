import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import { pane, type RouteGraph, type WorkKey } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { createGraphMount, type MountAdapters, type MountScope } from "./mount-owner";
import type { ReadingContext, ReadingDelivery } from "./readings";
import type { ReadingWorkerPort } from "./readings-worker";
import { workerSource } from "./readings-worker";
import { workVerb } from "./verbs";

const key: WorkKey = { binding: "workspace", route: "failed-proof", target: null, work: "one" };
type Page = { stage: string };
type Doc = { n: number };

/** A verb that arms from a worker reading's value, the way ducts' Price arms from pricing. */
function fixture() {
  const scope: MountScope<Doc> = {
    target: { kind: "host" },
    work: { handle: { key, revision: 0 }, doc: { n: 0 } },
  };
  const feeds: { ctx: ReadingContext; deliver: ReadingDelivery }[] = [];
  const posted: { id: number; input: unknown }[] = [];
  let port!: ReadingWorkerPort<unknown, string>;
  const reply = (data: { id: number; error: string } | { id: number; result: string }) =>
    port.onmessage!({ data });
  const graph: RouteGraph<Page, Doc> = {
    key: "failed-proof",
    address: "failed-proof",
    name: "Failed proof",
    fields: { stage: { ...field(z.string().default("edit"), {}), role: "stage" } },
    readings: {
      input: { kind: "use", source: "input", retire: "target" },
      calc: { kind: "worker", source: "calc", deps: ["input"], retire: "target" },
    },
    verbs: {
      go: workVerb(
        { label: "Go", input: z.object({ refusal: z.string().nullable() }) },
        {
          ready: (_scope, input) => input.refusal,
          patches: () => [{ path: ["n"], value: 1 }],
        },
      ),
    },
    panes: { body: { label: "Body", purpose: "Show", draws: ["calc"], verbs: [] } },
    layout: pane("body"),
    stages: { edit: { word: "Editing", panes: ["body"], verbs: ["go"] } },
  };
  const adapters: MountAdapters<Page, Doc> = {
    getSnapshot: () => scope,
    subscribe: () => () => {},
    sources: {
      input: {
        kind: "use",
        open: (ctx, deliver) => {
          feeds.push({ ctx, deliver });
          deliver({ kind: "complete", value: { rows: 1 }, revision: 0 });
        },
      },
      calc: workerSource<unknown, string>({
        algorithmVersion: "v1",
        input: (ctx) => ctx.inputs.input!.value,
        spawn: () => {
          port = {
            postMessage: (request) => posted.push({ id: request.id, input: request.input }),
            terminate: () => {},
            onmessage: null,
            onerror: null,
          };
          return port;
        },
      }),
    },
    write: async () => {
      throw Error("not written");
    },
    subscribeAcceptedDeltas: () => () => {},
    // The route's own sentence, like ducts' "Reading X is refreshing", must lose to the kernel's.
    binding: (_id, _row, bound) => ({
      subject: null,
      args: { refusal: bound.readings.calc?.current ? null : "Reading calc is refreshing" },
    }),
    verbDepends: { go: ["calc"] },
  };
  return { graph, adapters, feeds, posted, reply };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const release of cleanups.splice(0).reverse()) release();
});
function mounted() {
  const f = fixture();
  const owner = createGraphMount(f.graph, f.adapters);
  const disconnect = owner.connect();
  const release = owner.readings.mount(["calc"]);
  cleanups.push(() => {
    release();
    disconnect();
    owner.dispose();
  });
  return { ...f, owner };
}

test("a failed worker reading names its failure to the verb and holds until its inputs change", async () => {
  const { owner, feeds, posted, reply } = mounted();
  expect(posted).toHaveLength(1);
  expect(owner.control("go").refusal).toBe("Reading calc is refreshing");

  reply({ id: posted[0]!.id, error: "Cannot read properties of null (reading '0')" });
  expect(owner.readings.get("calc").status).toBe("failed");
  expect(owner.control("go").refusal).toBe(
    "calc failed: Cannot read properties of null (reading '0')",
  );
  expect(await owner.control("go").run()).toMatchObject({
    state: "refused",
    refusal: { message: "calc failed: Cannot read properties of null (reading '0')" },
  });

  // A dependency tick over the same value is not a changed input: no re-run, still failed.
  const value = owner.readings.get("input").value;
  feeds[0]!.deliver({ kind: "complete", value, revision: 1 });
  expect(posted).toHaveLength(1);
  expect(owner.readings.get("calc").status).toBe("failed");
  expect(owner.control("go").refusal).toContain("calc failed:");

  // A changed input re-runs it; success arms the verb.
  feeds[0]!.deliver({ kind: "complete", value: { rows: 2 }, revision: 2 });
  expect(posted).toHaveLength(2);
  expect(owner.readings.get("calc").status).toBe("pending");
  expect(owner.control("go").refusal).toBe("Reading calc is refreshing");
  reply({ id: posted[1]!.id, result: "priced" });
  expect(owner.readings.get("calc")).toMatchObject({ status: "ready", value: "priced" });
  expect(owner.control("go").refusal).toBeNull();
});
