/**
 * One mounted route over the real host: the HTTP read graph, the Work store and the typed mount
 * are production. Two parts are recorded: the native boundary (`native`), and the command door,
 * which answers a sealed command without Revit.
 */
import { cleanup, waitFor } from "@testing-library/react";
import { expect } from "vite-plus/test";
import { actionReceiptSchema, bindWork } from "@pe/agent-contracts";
import { SHEET_COMMANDS } from "@pe/agent-contracts/slots";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import type { UseSource } from "@pe/agent-contracts/route";
import { refusalOf } from "@pe/web-kernel/route/typed-route";
import type {
  AcceptedResult,
  WorkJournalDoor,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { bindControl } from "../../../host/src/control";
import { testRegistry } from "../../../host/tests/effect-test";
import { fixture, path, ref } from "../../../host/tests/host-read-graph.test-support";
import type { Readings } from "../host/resource-stream";
import { routeRegistry } from "../route/registry";
import { fixtureTimeline } from "./fixture-work-door";
import { mountTypedRoute, type TypedMount } from "./typed-mount";
import { completion } from "./work-door-observation";
import { createWorkFeedClient } from "./work-feed-client";

export { path, ref };
export type Native = (key: string, input: any) => unknown;
export type JourneyDocument = { ref: typeof ref; path: typeof path; title?: string };

/** One document's fixture host and the ports a typed mount takes from it. */
export async function hosted(
  route: string,
  /** The host reads this route's panes open. */
  reads: string[],
  native: Native,
  { ref, path, title = "Snowdon" }: JourneyDocument,
) {
  const nativeCalls: { key: string; input: unknown }[] = [];
  const actions: { key: string; input: Record<string, unknown> }[] = [];
  bindControl({ runs: testRegistry(), acquired: () => null });
  const host = await fixture(true, {
    actions: true,
    inventory: {
      sessions: [
        {
          sessionId: ref.session,
          connected: true,
          openDocumentCount: 1,
          openDocuments: [
            {
              ...ref,
              title,
              address: path,
              isActive: true,
              isFamilyDocument: false,
              projectHome: null,
            },
          ],
        },
      ],
    },
    async read(input) {
      nativeCalls.push({ key: input.key, input: input.input });
      return native(input.key, input.input);
    },
  });
  let generation = 0;
  const pending = new Set<Promise<unknown>>(),
    listeners = new Set<() => void>();
  const source = (read: string): UseSource => ({
    kind: "use",
    open(ctx, deliver) {
      let closed = false,
        version = 0;
      const refresh = () => {
        const mine = ++version;
        const stamp = ++generation;
        deliver({ kind: "stale" });
        const task = host
          .probe({
            read,
            args: { ...(ctx.args as object), target: ref },
            subscription: `${route}-${stamp}`,
            generation: stamp,
          })
          .then(async (response) => {
            if (!response.ok) throw Error(await response.text());
            const packet = await response.json();
            if (!closed && !ctx.signal.aborted && mine === version)
              deliver({ kind: "complete", value: packet, revision: stamp });
          })
          .catch((error) => {
            if (!closed && !ctx.signal.aborted && mine === version)
              deliver({ kind: "failure", error });
          });
        pending.add(task);
        void task.finally(() => pending.delete(task));
      };
      listeners.add(refresh);
      refresh();
      return () => {
        closed = true;
        listeners.delete(refresh);
      };
    },
  });
  const stopWork = host.workspace.subscribeUncaptured(() => listeners.forEach((f) => f()));
  const streams = new Set<() => void>();
  const readings: Readings = {
    subscribe(reading, deliver) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
        closed = false;
      const stop = () => {
        closed = true;
        void reader?.cancel();
        streams.delete(stop);
      };
      streams.add(stop);
      void (async () => {
        const url = new URL(peRouteUrl("resources.stream", {}), "http://host");
        url.searchParams.set("keys", JSON.stringify([reading]));
        const response = await host.request(new Request(url));
        reader = response.body!.getReader();
        if (closed) return void reader.cancel();
        let buffer = "";
        const decoder = new TextDecoder();
        while (!closed) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            for (const line of frame.split("\n"))
              if (line.startsWith("data: ")) deliver(JSON.parse(line.slice(6)));
          }
        }
      })();
      return stop;
    },
    dirty() {},
  };
  const feed = createWorkFeedClient(readings, {
    write: (key, write) => host.workspace.write(key, key.route, "human", write, async () => []),
    submit: async (command) => {
      const response = await host.request(
        new Request("http://host/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        }),
      );
      expect([200, 202], await response.clone().text()).toContain(response.status);
      await host.journal.wait(command.id);
      return actionReceiptSchema.parse((await host.journal.list(undefined, command.id))[0]);
    },
  });
  const reread = () => {
    host.changed();
    listeners.forEach((refresh) => refresh());
  };
  const work: WorkJournalDoor = {
    ...feed,
    submit(command) {
      if (command.key === "work.start") return feed.submit(command);
      actions.push({ key: command.key, input: command.input });
      const preview = command.key.endsWith(".preview") || command.key === SHEET_COMMANDS.plan;
      const result = preview
        ? {
            previewOnly: true,
            derivedRequest: {},
            seal: {
              caller: { kind: "human", via: "local" },
              requestHash: "recorded",
              work: { handle: command.input.work },
              documentMark: { ...ref, observedSince: 1, changedAt: 10 },
              incarnation: null,
              dependencies: "recorded",
            },
          }
        : (native(`command:${command.key}`, command.input) ?? {});
      return {
        lifetime: "command",
        key: command.key,
        handle: { lifetime: "command", id: command.id as never, causalParent: command.id as never },
        accepted: completion<AcceptedResult>({ kind: "pending" }, async () => {
          // A committed write changes the document: every reading of it is read again.
          if (!preview) reread();
          return {
            kind: "accepted-native",
            receiptId: command.id,
            outcome: "committed",
            result,
          };
        }),
      };
    },
  };
  return {
    host,
    actions,
    nativeCalls,
    reread,
    ports: {
      work,
      timeline: fixtureTimeline(host.workspace),
      sources: Object.fromEntries(reads.map((read) => [read, source(read)])),
    },
    async close() {
      stopWork();
      await Promise.allSettled([...pending]);
      for (const stop of streams) stop();
      await host.close();
    },
  };
}

export async function mounted(
  module: { spec: { key: string } },
  reads: string[],
  native: Native,
  { search = new URLSearchParams(), start = true, document = { ref, path } } = {},
) {
  const { ref, path } = document;
  const route = module.spec.key;
  const { host, actions, nativeCalls, reread, ports, close } = await hosted(
    route,
    reads,
    native,
    document,
  );
  const writes: { search: string; history: unknown }[] = [];
  const mount = mountTypedRoute(
    module as never,
    {
      fixture: null,
      target: { kind: "document", ref },
      work: { address: path, open: ref },
      custody: { current: () => true },
      memory: () => ({}),
      address: {
        read: () => new URLSearchParams(search),
        write(next: URLSearchParams, history: unknown) {
          search = new URLSearchParams(next);
          writes.push({ search: search.toString(), history });
        },
        subscribe: () => () => {},
      },
    } as never,
    routeRegistry[route]!.fingerprint,
    ports,
  ) as TypedMount;
  const stop = mount.subscribe(() => {});
  await waitFor(() => expect(mount.startAction()).not.toBeNull());
  if (start) await mount.startAction()!.run();
  return {
    host,
    mount,
    actions,
    nativeCalls,
    writes,
    key: bindWork(route as never, path, undefined, ref),
    search: () => new URLSearchParams(search),
    reread,
    /** The core reading is delivered and Work is open: the screen can be edited. */
    ready: () =>
      waitFor(
        () => {
          const value = mount.value();
          expect(value.state, value.state === "ready" ? "" : (refusalOf(value) ?? "")).toBe(
            "ready",
          );
          expect(mount.workBasis()).toBeTruthy();
        },
        { timeout: 20000 },
      ),
    async close() {
      cleanup();
      stop();
      mount.dispose();
      await close();
    },
  };
}
