import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { address, roomEditKey, tools } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { markDispatched } from "../src/action-dispatch.ts";
import { commandResources } from "../src/command-reads.ts";
import { takeoffExecutors } from "../src/takeoff-actions.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import type { RevitBridge } from "../src/bridge.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { RunConsents, type ConsentEvent } from "../src/run-consent.ts";
import { bindControl } from "../src/control.ts";

test.each(["selected", "unrelated"] as const)(
  "rooms.write freezes requested room fields while %s Work changes after binding",
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
    const runs = new RunConsents((_run, event) => events.push(event));
    const run = { thread: "rooms-thread", turn: "rooms-turn" };
    runs.open(run);
    bindControl({ runs });
    const bridge = {
      list: Effect.succeed([
        {
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
        },
      ]),
      invoke: (key: string, input: unknown, _session: string, _document: string, id: string) =>
        Effect.promise(async () => {
          await markDispatched(id);
          calls.push({ key, input });
          return {
            value: key === "takeoffs.initialize-carrier" ? { remaining: [] } : { written: 1 },
          };
        }),
    } as unknown as RevitBridge["Service"];
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
      const owner = new ActionJournal(join(directory, "journal.jsonl"));
      const deps = { workspace: work, sdk: sdkSessions };
      const entry = takeoffExecutors(new TakeoffCaptures(directory), bridge, deps)["rooms.write"];
      owner.bindCommands({
        ...commandResources(bridge, deps, async (id) => (await owner.list(undefined, id))[0]),
        resolve: () => entry,
      });
      await owner.invoke(
        {
          id: "write",
          key: "rooms.write",
          target: { kind: "document", ref: target },
          input: {
            work: { key, revision: rendered.revision },
            regions: [{ guid: "room-a", name: "reviewed-a" }],
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
      if (changed === "selected") {
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
          { key: "rooms.write", input: { regions: [{ guid: "room-a", name: "reviewed-a" }] } },
        ]);
        expect((await work.read(key, "rooms"))!.doc).toMatchObject({
          edits: { [b]: { edit: { value: "newer" } } },
        });
      }
    } finally {
      runs.closeAll();
      bindControl({ runs: undefined });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
