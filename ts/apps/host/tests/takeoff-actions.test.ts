import { detachedBridge, sessionView, testConsents, captureStore } from "./effect-test.ts";
import { workWriteBoundary } from "../src/work-write-boundary.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { address, commands, roomEditKey, tools } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { markDispatched } from "../src/action-dispatch.ts";
import { commandResources } from "../src/command-reads.ts";
import { takeoffExecutors } from "../src/takeoff-actions.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import type { ConsentEvent } from "../src/run-consent.ts";
import { bindControl } from "../src/control.ts";

test.each(["selected", "unrelated", "none"] as const)(
  "rooms.write derives all edited fields and guards %s changes after preview",
  async (changed) => {
    const directory = await mkdtemp(join(tmpdir(), "pe-rooms-command-"));
    const target = { session: "rooms-session", openId: "rooms-document" };
    const at = address("C:/Models/Rooms.rvt");
    const key = { binding: "address" as const, target: at, route: "rooms" };
    const a = roomEditKey("room-a", "name"),
      b = roomEditKey("room-b", "name");
    let state: unknown;
    const work = new RouteWorkspace({
      registrations: [{ spec: tools.rooms.work }],
      store: {
        getState: async () => state,
        setState: async ({ value }) => {
          state = structuredClone(value);
        },
      },
    });
    const calls: { key: string; input: unknown }[] = [];
    const events: ConsentEvent[] = [];
    const runs = testConsents((_run, event) => events.push(event));
    const run = { thread: "rooms-thread", turn: "rooms-turn" };
    runs.open(run);
    bindControl({ runs });
    const bridge = detachedBridge({
      list: Effect.succeed([
        sessionView({
          sessionId: target.session,
          connected: true,
          processId: 42,
          processStartUtcUnixMs: 1000,
          lane: hostOwnership.lane,
          sourceRoot: hostOwnership.sourceRoot,
          serviceName: hostOwnership.serviceName,
          state: {
            openDocuments: [
              {
                openId: target.openId,
                address: at,
                title: "Rooms.rvt",
                isActive: true,
                isFamilyDocument: false,
              },
            ],
          },
        }),
      ]),
      invoke: (key: string, input: unknown, _session?: string, _document?: string | null, id?: string) =>
        Effect.promise(async () => {
          await markDispatched(id!);
          calls.push({ key, input });
          return {
            target: { session: _session!, document: null },
            value: key === "takeoffs.initialize-carrier" ? { remaining: [] } : { written: 1 },
          };
        }),
    });
    try {
      await work.publish(
        key,
        "rooms",
        [
          { path: ["edits", a], value: { edit: { value: "reviewed-a" } } },
          { path: ["edits", b], value: { edit: { value: "reviewed-b" } } },
        ],
        0,
      );
      const rendered = (await work.read(key, "rooms"))!;
      const owner = new ActionJournal(join(directory, "journal.jsonl"), Date.now);
      const deps = { workspace: work, sdk: sdkSessions };
      const write = takeoffExecutors(captureStore(directory), bridge, deps)["rooms.write"];
      const entries: Record<string, ReturnType<typeof workWriteBoundary>> = {
        "rooms.write": workWriteBoundary(write, bridge, deps),
        "rooms.write.preview": workWriteBoundary(
          { ...write, definition: commands["rooms.write.preview"] },
          bridge,
          deps,
        ),
      };
      owner.bindCommands({
        ...commandResources(bridge, deps, async (id) => (await owner.list(undefined, id))[0]),
        resolve: (key) => entries[key]!,
      });
      await owner.invoke(
        {
          id: "preview",
          key: "rooms.write.preview",
          target: { kind: "document", ref: target },
          input: { work: { key, revision: rendered.revision } },
        },
        { caller: { kind: "human", via: "local" }, basis: { kind: "human" } },
      );
      expect((await owner.wait("preview")).state).toBe("succeeded");
      await owner.invoke(
        {
          id: "write",
          key: "rooms.write",
          target: { kind: "document", ref: target },
          input: {
            work: { key, revision: rendered.revision },
          },
        },
        {
          caller: { kind: "pea", context: "rooms-test", thread: run.thread, run, root: run },
          basis: null,
        },
      );
      await vi.waitFor(() =>
        expect(events.some((event) => event.kind === "permission_request")).toBe(true),
      );
      if (changed !== "none")
        await work.publish(
          key,
          "rooms",
          [{ path: ["edits", changed === "selected" ? a : b, "edit", "value"], value: "newer" }],
          rendered.revision,
        );
      const ask = events.find((event) => event.kind === "permission_request");
      if (ask?.kind !== "permission_request") throw Error("Missing root consent request");
      runs.decide(run.thread, ask.requestId, "allow_now");
      const receipt = await owner.wait("write");
      if (changed !== "none") {
        expect(receipt).toMatchObject({
          state: "failed",
          notDispatched: true,
          refusal: { kind: "stale" },
        });
        expect(calls).toEqual([]);
      } else {
        expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
        expect(calls).toEqual([
          { key: "takeoffs.initialize-carrier", input: { stage: "Rooms" } },
          {
            key: "rooms.write",
            input: {
              regions: [
                { guid: "room-a", name: "reviewed-a" },
                { guid: "room-b", name: "reviewed-b" },
              ],
            },
          },
        ]);
        expect((await work.read(key, "rooms"))!.doc).toMatchObject({
          edits: { [b]: { edit: { value: "reviewed-b" } } },
        });
      }
    } finally {
      runs.closeAll();
      bindControl({ runs: undefined });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
