/// <reference lib="es2024.collection" />
import { actionAdmissionSchema, stagedTakeoffEdits, takeoffsRouteState } from "@pe/agent-contracts";
import { test, expect } from "vite-plus/test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { checkoutRoot } from "../../checkout-paths.ts";
import { takeoffSeeds } from "#/takeoff/seeds";
import { createDemoOwner } from "../../../host/src/demo-owner";
import { takeoffExecutors, fileVersion } from "../../../host/src/takeoff-actions";
import { sdkSessions, readRhvacFixture } from "../../../host/tests/native-receipt-fixture";
import type { RevitBridge } from "../../../host/src/bridge";
import { crossingOf } from "../../../host/tests/callers";
import { ActionJournal } from "../../../host/src/action-journal";
import { commandResources } from "../../../host/src/command-reads";

const crossing = crossingOf("human");

/** Explicit native integration only. Ordinary catalogue tests never need this file or Jet. */
test.skipIf(process.env.PE_DEMO_JET !== "1")(
  "real Jet Sync on an owned copy retains native receipts, Work publication and stale-file refusal",
  async () => {
    const fixture = process.env.PE_DEMO_RHVAC_FIXTURE;
    if (!fixture)
      throw Error("PE_DEMO_RHVAC_FIXTURE must name an explicitly supplied integration fixture");
    const root = await mkdtemp(join(tmpdir(), "pe-native-rhvac-integration-"));
    const path = join(root, "integration.r10");
    let owner: Awaited<ReturnType<typeof createDemoOwner>> | undefined;
    let journal: ActionJournal | undefined;
    try {
      await copyFile(fixture, path);
      const beforeHash = await fileVersion(path);
      const before = await readRhvacFixture(path);
      // The Takeoffs seeds are plain manifest data now; the demo map they used to live in is deleted.
      const seed = structuredClone(
        (
          takeoffSeeds as unknown as Record<
            string,
            { page: { zones: unknown[] }; readings: { snapshot: any } }
          >
        ).sync!,
      );
      seed.readings.snapshot.world.zones[0]!.tags = [before.systems[0]!.name];
      owner = await createDemoOwner(join(root, "owner"), seed);
      const current = owner;
      const snapshot = {
        ...seed.readings.snapshot,
        reading: { ...seed.readings.snapshot.reading, at: owner.at },
        world: { ...seed.readings.snapshot.world, r10Path: path },
      };
      const capture = await owner.captures.refresh(
        owner.target,
        async () => ({ result: null, snapshot }),
        async () => true,
      );
      const nativeLinks: unknown[] = [];
      const bridge = {
        list: Effect.succeed([
          {
            sessionId: owner.target.session,
            processId: 42,
            processStartUtcUnixMs: 1000,
            state: {
              openDocuments: [
                { openId: owner.target.openId, address: owner.at, isFamilyDocument: false },
              ],
            },
          },
        ]),
        invoke: (key: string, input: unknown) =>
          Effect.sync(() => {
            if (key !== "takeoffs.rhvac-links") throw Error(`Unexpected native operation ${key}`);
            nativeLinks.push(input);
            return {
              value: { simulated: true },
              target: { session: current.target.session, document: current.at },
            };
          }),
      } as unknown as RevitBridge["Service"];
      const work = await owner.work.read(owner.scope, "takeoffs");
      const admission = actionAdmissionSchema.parse({
        id: `${owner.id}:jet`,
        key: "takeoffs.sync",
        target: { kind: "document", ref: owner.target },
        input: {
          path,
          zones: seed.page.zones,
          captureId: capture.capture.id,
          fileVersion: beforeHash,
          work: { key: owner.scope, revision: work!.revision },
        },
      });
      const deps = { workspace: owner.work, sdk: sdkSessions };
      const executors = takeoffExecutors(owner.captures, bridge, deps);
      const runtime = (journal = new ActionJournal(join(root, "integration-journal.jsonl")));
      runtime.bindCommands({
        ...commandResources(bridge, deps, async (id) => (await runtime.list(undefined, id))[0]),
        resolve: (key) => {
          const entry = executors[key as keyof typeof executors];
          if (!entry) throw Error(`No integration executor for ${key}`);
          return entry;
        },
      });
      await runtime.invoke(admission, crossing);
      const receipt = await runtime.wait(admission.id);
      expect(receipt.state).toBe("succeeded");
      expect(await fileVersion(path)).not.toBe(beforeHash);
      expect(nativeLinks).toHaveLength(1);
      const after = await readRhvacFixture(path);
      expect(after.rooms.some((room) => room.name === "Reviewed demo room")).toBe(true);
      // Proven consumed edits retire; the receipt remains the record.
      expect(
        stagedTakeoffEdits(
          takeoffsRouteState.schema.parse((await owner.work.read(owner.scope, "takeoffs"))!.doc),
        ),
      ).toEqual({});
      const afterHash = await fileVersion(path);
      await runtime.invoke(admission, crossing);
      expect(nativeLinks).toHaveLength(1);
      expect(await fileVersion(path)).toBe(afterHash);
      const staleId = `${owner.id}:stale`;
      await runtime.invoke(
        {
          ...admission,
          id: staleId,
          input: {
            ...admission.input,
            work: {
              key: owner.scope,
              revision: (await owner.work.read(owner.scope, "takeoffs"))!.revision,
            },
          },
        },
        crossing,
      );
      expect(await runtime.wait(staleId)).toMatchObject({
        state: "failed",
        steps: [],
        error: "RHVAC file changed before admission",
      });
      expect(
        JSON.stringify(await readFile(join(root, "integration-journal.jsonl"), "utf8")),
      ).toContain(admission.id);
    } finally {
      // Preserve failed/unknown receipts before deleting only this integration test's owned root.
      const evidence = join(
        checkoutRoot,
        ".artifacts/handoffs/route-goal",
        `demo-native-rhvac-${randomUUID()}.json`,
      );
      await mkdir(join(evidence, ".."), { recursive: true });
      try {
        await writeFile(
          evidence,
          JSON.stringify(
            {
              fixture,
              receipts: journal ? await journal.list() : [],
              proof: "Real Jet integration; simulated native links; no application launch",
            },
            null,
            2,
          ),
          "utf8",
        );
      } finally {
        try {
          await owner?.dispose();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    }
  },
  300000,
);
