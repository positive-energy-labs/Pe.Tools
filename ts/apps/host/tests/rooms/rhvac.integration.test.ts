import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import {
  address,
  stagedTakeoffEdits,
  takeoffEditKey,
  takeoffObservationSchema,
} from "@pe/agent-contracts";
import { product, takeoffsWork } from "@pe/rooms-contract/product";
import { RouteWorkspace } from "@pe/runtime";
import { checkoutRoot } from "../../../web/checkout-paths.ts";
import { mkdtemp } from "../../../../tests/isolated-home/storage.ts";
import { fileVersion } from "../../src/rhvac-ops.ts";
import { captureStore, settle, testDocumentMarks } from "../effect-test.ts";
import { fixtureNative } from "../fixture-native.ts";
import { readRhvacFixture, sdkSessions } from "../native-receipt-fixture.ts";
import syncSeed from "./fixtures/sync-seed.json" with { type: "json" };

const command = product.commands["takeoffs.sync"];

/** Explicit Jet integration: real file writes on an owned copy, with recorded native replies. */
test.skipIf(process.env.PE_DEMO_JET !== "1")(
  "real Jet Sync on an owned copy retains native receipts, Work publication and stale-file refusal",
  async () => {
    const fixture = process.env.PE_DEMO_RHVAC_FIXTURE;
    if (!fixture)
      throw Error("PE_DEMO_RHVAC_FIXTURE must name an explicitly supplied integration fixture");
    const root = await mkdtemp(join(tmpdir(), "pe-native-rhvac-integration-"));
    const path = join(root, "integration.r10");
    let native: Awaited<ReturnType<typeof fixtureNative>> | undefined;
    try {
      await copyFile(fixture, path);
      const beforeHash = await fileVersion(path);
      const before = await readRhvacFixture(path);
      native = await fixtureNative(join(root, "native"), "fresh-takeoffs.rhvac-links");
      const { bridge, calls, journal } = native;
      const { target: ref } = await native.connect();
      const at = address("C:/model.rvt");
      const key = { binding: "address" as const, route: takeoffsWork.route, target: at };
      const captures = captureStore(join(root, "captures"));
      let state: unknown;
      const workspace = new RouteWorkspace({
        publicationAuthor: () => "human",
        registrations: [{ spec: takeoffsWork }],
        store: {
          getState: async () => state,
          setState: async ({ value }) => {
            state = structuredClone(value);
          },
        },
      });

      const recorded = takeoffObservationSchema.parse(syncSeed.snapshot);
      if (recorded.kind !== "ready") throw Error("Expected a saved snapshot seed");
      const snapshot = structuredClone(recorded.capture.snapshot);
      snapshot.reading.at = at;
      snapshot.world.r10Path = path;
      const zone = snapshot.world.zones[0]!;
      const room = zone.rooms.find((row) => row.data !== null)!;
      zone.rooms = [room];
      zone.tags = [before.systems[0]!.name];
      zone.driftSqft = 0;
      zone.runs = [];
      room.elementId = 21;
      room.r10 = null;
      room.flags = [];
      room.analysis = { state: "current", hold: null, runId: null, floorZ: null, ceilingZ: null };
      snapshot.world.zones = [zone];
      const capture = await settle(
        captures.refresh(ref, Effect.succeed({ result: null, snapshot }), Effect.succeed(true)),
      );

      const staged = await workspace.publish(
        key,
        key.route,
        [
          {
            path: ["edits", takeoffEditKey(room.guid, "name")],
            value: { edit: { value: "Reviewed demo room" } },
          },
          {
            path: ["writeIntent", "takeoffs.sync"],
            value: {
              edit: {
                value: {
                  path,
                  zones: [zone.zone.guid],
                  captureId: capture.capture.id,
                  fileVersion: beforeHash,
                },
              },
            },
          },
        ],
        0,
      );
      if (!staged.ok) throw Error(JSON.stringify(staged));
      const work = { key, revision: staged.revision };
      const target = { kind: "document", ref };
      const post = native.actions(
        { workspace, sdk: sdkSessions, marks: testDocumentMarks(bridge) },
        captures,
      );
      const invoke = async (id: string, commandKey: string, input: { work: typeof work }) => {
        const response = await post({ id, key: commandKey, target, input });
        expect([200, 202], await response.clone().text()).toContain(response.status);
        return journal.wait(id);
      };

      const previewKey = command.writeBoundary.previewKey;
      const plan = await invoke("plan", previewKey, { work });
      expect(plan.state, "error" in plan ? plan.error : undefined).toBe("succeeded");
      const receipt = await invoke("sync", "takeoffs.sync", { work });
      expect(receipt.state, "error" in receipt ? receipt.error : undefined).toBe("succeeded");
      expect(receipt.steps.map(({ kind }) => kind)).toEqual(["file", "native", "publication"]);
      expect(calls.map(({ key }) => key)).toEqual([
        "takeoffs.rhvac-links.preflight",
        "takeoffs.rhvac-links",
      ]);
      const afterHash = await fileVersion(path);
      expect(afterHash).not.toBe(beforeHash);
      const after = await readRhvacFixture(path);
      expect(after.rooms.some((row) => row.name === "Reviewed demo room")).toBe(true);
      const saved = (await workspace.read(key, key.route))!;
      expect(stagedTakeoffEdits(takeoffsWork.schema.parse(saved.doc))).toEqual({});

      expect((await invoke("sync", "takeoffs.sync", { work })).state).toBe("succeeded");
      const stale = await invoke("stale", previewKey, { work: { key, revision: saved.revision } });
      expect(stale).toMatchObject({
        state: "failed",
        steps: [],
        refusal: { kind: "stale", consumed: [{ kind: "file", probe: { path } }] },
      });
      expect(calls).toHaveLength(2);
      expect(await fileVersion(path)).toBe(afterHash);
    } finally {
      // Preserve the command receipts before deleting the owned copy.
      const evidence = join(
        checkoutRoot,
        ".artifacts/handoffs/route-goal",
        `demo-native-rhvac-${randomUUID()}.json`,
      );
      try {
        await mkdir(join(evidence, ".."), { recursive: true });
        await writeFile(
          evidence,
          JSON.stringify(
            {
              fixture,
              receipts: native ? await native.journal.list() : [],
              proof: "Real Jet integration; recorded native links; no Revit launch",
            },
            null,
            2,
          ),
          "utf8",
        );
      } finally {
        await native?.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  },
  300_000,
);
