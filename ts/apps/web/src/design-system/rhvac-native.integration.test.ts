import { stagedTakeoffEdits, takeoffsRouteState } from "@pe/agent-contracts";
import { test, expect } from "vite-plus/test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { checkoutRoot } from "../../checkout-paths.ts";
import { manifest as takeoffManifest } from "#/takeoff/manifest";
import { createDemoOwner } from "../../../host/src/demo-owner";
import { admitTakeoffAction, fileVersion } from "../../../host/src/takeoff-actions";
import { sdkSessions, readRhvacFixture } from "../../../host/tests/native-receipt-fixture";
import type { RevitBridge } from "../../../host/src/bridge";

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
    try {
      await copyFile(fixture, path);
      const beforeHash = await fileVersion(path);
      const before = await readRhvacFixture(path);
      // The Takeoffs seeds are plain manifest data now; the demo map they used to live in is deleted.
      const seed = structuredClone(
        (
          takeoffManifest.seeds as unknown as Record<
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
      const admission = {
        id: `${owner.id}:jet`,
        key: "takeoffs.sync",
        actor: "human",
        destination: { kind: "document", ref: owner.target },
        input: { path, zones: seed.page.zones },
        bases: {
          captureId: capture.capture.id,
          fileVersion: beforeHash,
          work: { key: owner.scope, revision: work!.revision },
        },
      };
      const deps = { workspace: owner.work, sdk: sdkSessions };
      await admitTakeoffAction(admission, owner.journal, owner.captures, bridge, deps);
      const receipt = await owner.journal.wait(admission.id);
      expect(receipt.state).toBe("succeeded");
      expect(await fileVersion(path)).not.toBe(beforeHash);
      expect(nativeLinks).toHaveLength(1);
      const after = await readRhvacFixture(path);
      expect(after.rooms.some((room) => room.name === "Reviewed demo room")).toBe(true);
      // The consumed staged edit retired; nothing staged remains.
      expect(
        stagedTakeoffEdits(
          takeoffsRouteState.schema.parse((await owner.work.read(owner.scope, "takeoffs"))!.doc),
        ),
      ).toEqual({});
      const afterHash = await fileVersion(path);
      await admitTakeoffAction(admission, owner.journal, owner.captures, bridge, deps);
      expect(nativeLinks).toHaveLength(1);
      expect(await fileVersion(path)).toBe(afterHash);
      const staleId = `${owner.id}:stale`;
      await admitTakeoffAction(
        {
          ...admission,
          id: staleId,
          bases: {
            ...admission.bases,
            work: {
              scope: owner.scope,
              revision: (await owner.work.read(owner.scope, "takeoffs"))!.revision,
            },
          },
        },
        owner.journal,
        owner.captures,
        bridge,
        deps,
      );
      expect(await owner.journal.wait(staleId)).toMatchObject({
        state: "failed",
        steps: [],
        error: "RHVAC file changed before admission",
      });
      expect(JSON.stringify(await readFile(join(owner.root, "journal.json"), "utf8"))).toContain(
        admission.id,
      );
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
              receipts: owner ? await owner.journal.list() : [],
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
