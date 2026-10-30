// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { pane, type RouteGraph, type WorkKey } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { createGraphMount, type MountScope } from "./mount-owner";
import { pageVerb } from "./verbs";

test("K1.3/11: hydration acquires an image once; a new Target resets declared scope and fences old deliveries", () => {
  type Page = { view: string; filter: string };
  const graph: RouteGraph<Page, Record<string, never>> = {
    key: "proof",
    address: "proof",
    name: "Proof",
    needs: "document",
    work: z.object({}),
    fields: {
      view: { ...field(z.string().default(""), {}), role: "selection" },
      filter: { ...field(z.string().default(""), {}), role: "query" },
    },
    resetOnTarget: ["view"],
    readings: { image: { kind: "use", source: "image", retire: "target" } },
    verbs: {
      close: pageVerb({ label: "Close", input: z.object({}) }, { page: () => ({ view: "" }) }),
    },
    panes: { main: { label: "Main", purpose: "Proof", draws: ["image"], verbs: ["close"] } },
    stages: { main: { word: "Main", panes: ["main"], verbs: [] } },
    layout: pane("main"),
  };
  const key: WorkKey = {
    binding: "open",
    route: "proof",
    target: null,
    open: { session: "S", openId: "A" },
  };
  let scope: MountScope<Record<string, never>> = {
    target: { kind: "document", ref: key.open },
    workKey: key,
    work: null,
  };
  let update!: () => void;
  const attempts: { key: unknown; emit: (part: any) => void }[] = [];
  const write = vi.fn();
  const owner = createGraphMount(
    graph,
    {
      getSnapshot: () => scope,
      subscribe: (fn) => {
        update = fn;
        return () => {};
      },
      sources: {
        image: {
          kind: "use",
          open: (ctx, emit) => {
            attempts.push({ key: ctx.workKey, emit });
            emit({ kind: "complete", value: "A", revision: 0 });
          },
        },
      },
      write,
      subscribeAcceptedDeltas: () => () => {},
    },
    { view: "A view", filter: "kept" },
  );
  const disconnect = owner.connect();
  const release = owner.readings.mount(["image"]);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]!.key).toEqual(key);
  scope = { ...scope, work: { handle: { key: structuredClone(key), revision: 1 }, doc: {} } };
  update();
  expect(attempts).toHaveLength(1);
  scope = { ...scope, target: { kind: "document", ref: { session: "S", openId: "B" } } };
  update();
  expect(owner.view.read().page).toEqual({ view: "", filter: "kept" });
  expect(attempts).toHaveLength(2);
  attempts[0]!.emit({ kind: "complete", value: "late A", revision: 1 });
  expect(owner.readings.get("image").value).toBe("A");
  expect(write).not.toHaveBeenCalled();
  release();
  disconnect();
  owner.dispose();
});
