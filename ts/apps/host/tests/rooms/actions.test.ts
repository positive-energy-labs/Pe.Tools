import { mkdtemp } from "../../../../tests/isolated-home/storage.ts";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { address } from "@pe/agent-contracts";
import { product, regionCode, roomsWork, takeoffsWork } from "@pe/rooms-contract/product";
import { captureStore, testRegistry, testDocumentMarks } from "../effect-test.ts";
import { fixtureNative } from "../fixture-native.ts";
import { withRoomsSheet } from "./rooms-sheet.ts";
import { nativeRecordingRequest } from "../native-recordings.ts";
import { bindControl } from "../../src/control.ts";
import { nativeRequestSchema } from "@pe/host-contracts/decoders";
import type { HostOpResponse } from "@pe/host-contracts/operation-types";

const unreadableRooms: NonNullable<HostOpResponse<"takeoffs.record-replacements">["regions"]> = {
  owner: "rooms-regions",
  status: "Invalid",
  reason: "Rooms data needs a regions map",
  rawUtf8Sha256: "a".repeat(64),
};

test.each([null, unreadableRooms])(
  "a confirmed room draw seals replacement %j and consumes only its staged intent",
  async (replacing) => {
    const directory = await mkdtemp(join(tmpdir(), "pe-rooms-draw-"));
    const native = await fixtureNative(
      join(directory, "native"),
      "fresh-takeoffs.initialize-carrier",
      "fresh-rooms.draw",
    );
    const socket = await native.connect();
    native.reportTakeoffReplacements({ regions: replacing, registry: null });
    let state: unknown;
    const workspace = withRoomsSheet(
      new RouteWorkspace({
        publicationAuthor: () => "human",
        registrations: [{ spec: roomsWork }],
        store: {
          getState: async () => state,
          setState: async ({ value }) => {
            state = structuredClone(value);
          },
        },
      }),
    );
    const key = { binding: "address" as const, target: address("C:/model.rvt"), route: "rooms" };
    const post = native.actions(
      { workspace, marks: testDocumentMarks(native.bridge) },
      captureStore(directory),
    );
    const submit = async (id: string, command: string, revision: number) => {
      const response = await post({
        id,
        key: command,
        target: { kind: "document", ref: socket.target },
        input: { work: { key, revision } },
      });
      expect([200, 202], await response.clone().text()).toContain(response.status);
      return native.journal.wait(id);
    };
    try {
      const { role: _nativeNullRole, ...draw } = nativeRecordingRequest("fresh-rooms.draw");
      native.reportRoomsPlans([draw.view]);
      await workspace.publish(
        key,
        "rooms",
        [
          { path: ["writeIntent", "rooms.draw"], value: { edit: { value: draw } } },
          {
            path: ["writeIntent", "rooms.partition"],
            value: { edit: { value: { view: draw.view } } },
          },
        ],
        0,
      );
      const plan = await submit("plan", "rooms.draw.preview", 1);
      expect(plan, JSON.stringify(plan)).toMatchObject({
        state: "succeeded",
        result: { evidence: { regions: replacing } },
      });
      const receipt = await submit("draw", "rooms.draw", 1);
      expect(receipt).toMatchObject({
        state: "succeeded",
        result: { elementId: expect.any(Number), uniqueId: expect.any(String) },
      });
      const current = (await workspace.read(key, "rooms"))!;
      const doc = roomsWork.schema.parse(current.doc);
      expect(doc.writeIntent?.["rooms.partition"]?.edit?.value).toEqual({ view: draw.view });
      for (const command of ["rooms.draw.preview", "rooms.draw"])
        expect(await submit(`repeat-${command}`, command, current.revision)).toMatchObject({
          state: "failed",
          notDispatched: true,
          error: expect.stringContaining("No rooms.draw is staged"),
        });
      expect(await submit("draw", "rooms.draw", 1)).toEqual(receipt);
      expect(native.calls.map((call) => call.key)).toEqual(["rooms.draw"]);
      if (replacing) expect(native.calls[0]?.input).toMatchObject({ replacing });
      expect(doc.writeIntent?.["rooms.draw"]?.edit).toBeNull();
    } finally {
      await native.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.each(["initialize", "adopt", "partition"])(
  "Takeoffs %s preview accepts readWorks and apply dispatches strict native input",
  async (verb) => {
    const directory = await mkdtemp(join(tmpdir(), "pe-initialize-plan-"));
    const leaf =
      verb === "initialize"
        ? "takeoffs.initialize-carrier"
        : verb === "adopt"
          ? "takeoffs.adopt"
          : "takeoffs.partition";
    const action = `takeoffs.${verb}`;
    const native = await fixtureNative(
      join(directory, "native"),
      "fresh-takeoffs.initialize-carrier",
      `fresh-${leaf}`,
    );
    const socket = await native.connect();
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
    const key = { binding: "address" as const, route: "takeoffs", target: address("C:/model.rvt") };
    const post = native.actions(
      { workspace, marks: testDocumentMarks(native.bridge) },
      captureStore(directory),
    );
    try {
      await workspace.publish(
        key,
        "takeoffs",
        [
          {
            path: ["writeIntent", action],
            value: {
              edit: {
                value:
                  verb === "adopt"
                    ? { views: [nativeRecordingRequest(`fresh-${leaf}`)] }
                    : nativeRecordingRequest(`fresh-${leaf}`),
              },
            },
          },
        ],
        0,
      );
      const work = { key, revision: (await workspace.read(key, "takeoffs"))!.revision };
      const invoke = async (id: string, command: string) => {
        const response = await post({
          id,
          key: command,
          target: { kind: "document", ref: socket.target },
          input: { work, ...(id === "unplanned" ? {} : { readWorks: {} }) },
        });
        expect([200, 202], await response.clone().text()).toContain(response.status);
        return native.journal.wait(id);
      };
      expect(await invoke("unplanned", action)).toMatchObject({
        state: "failed",
        notDispatched: true,
        refusal: { code: "preview.stale" },
      });
      expect(native.calls).toEqual([]);
      expect(await invoke("plan", `${action}.preview`)).toMatchObject({
        state: "succeeded",
        result: { previewOnly: true },
      });
      expect(native.calls).toEqual([]);
      expect(await invoke("apply", action)).toMatchObject({ state: "succeeded" });
      expect(native.calls.map((call) => call.key)).toEqual(
        verb === "adopt" ? ["takeoffs.initialize-carrier", leaf] : [leaf],
      );
      if (verb === "adopt")
        expect(
          nativeRequestSchema("takeoffs.initialize-carrier").safeParse(native.calls[0]!.input)
            .success,
        ).toBe(true);
      expect(nativeRequestSchema(leaf).safeParse(native.calls.at(-1)!.input).success).toBe(true);
    } finally {
      await native.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.each(["selected", "unrelated", "none", "foreign", "unreadable"] as const)(
  "recorded Rooms sheet admission fences %s changes and a current preview retires only confirmed field values",
  async (changed) => {
    const directory = await mkdtemp(join(tmpdir(), "pe-rooms-recorded-"));
    const native = await fixtureNative(
      join(directory, "native"),
      "fresh-takeoffs.initialize-carrier",
      "fresh-rooms.write",
      "fresh-rooms.partition",
      "fresh-rooms.draw",
    );
    const socket = await native.connect();
    const key = { binding: "address" as const, target: address("C:/model.rvt"), route: "rooms" };
    const regions = nativeRecordingRequest("fresh-rooms.write").regions as {
      uniqueId: string;
      name: string;
    }[];
    native.reportTrackedRooms(regions.map(({ uniqueId }) => uniqueId));
    const a = regionCode(regions[0]!.uniqueId),
      b = regionCode(regions[1]!.uniqueId);
    let state: unknown;
    const work = withRoomsSheet(
      new RouteWorkspace({
        publicationAuthor: () => "human",
        registrations: [{ spec: roomsWork }],
        store: {
          getState: async () => state,
          setState: async ({ value }) => {
            state = structuredClone(value);
          },
        },
      }),
    );
    const runs = testRegistry();
    const run = { thread: "rooms-recorded", turn: "write" };
    runs.open(run);
    bindControl({ runs });
    const post = native.actions(
      { workspace: work, marks: testDocumentMarks(native.bridge) },
      captureStore(directory),
    );
    const submit = async (
      id: string,
      command: string,
      revision: number,
      caller?: Parameters<typeof post>[1],
    ) => {
      const response = await post(
        {
          id,
          key: command,
          target: { kind: "document", ref: socket.target },
          input: { work: { key, revision } },
        },
        caller,
      );
      expect([200, 202], await response.clone().text()).toContain(response.status);
      return native.journal.wait(id);
    };
    const foreign = "d453732c-41bf-4858-87b8-f116504e7c95-00c67840";
    const partition = nativeRecordingRequest("fresh-rooms.partition");
    native.reportRoomsPlans([partition.view]);
    try {
      if (changed === "unreadable")
        native.reportTakeoffReplacements({ regions: unreadableRooms, registry: null });
      await work.publish(
        key,
        "rooms",
        [...regions, ...(changed === "foreign" ? [{ uniqueId: foreign, name: "Foreign" }] : [])].map(
          (region) => ({
            path: ["name", regionCode(region.uniqueId)],
            value: { edit: { value: region.name } },
          }),
        ),
        0,
      );
      const revision = (await work.read(key, "rooms"))!.revision;
      const preview = await submit("preview", "sheet.plan", revision, {
        kind: "pea",
        context: "rooms-recorded",
        thread: run.thread,
        run,
        root: run,
      });
      if (changed === "unreadable") {
        expect(preview).toMatchObject({
          state: "failed",
          notDispatched: true,
          error: expect.stringMatching(/rooms.draw.*rooms.partition.*takeoffs.adopt/),
        });
        expect(await submit("refused-apply", "sheet.apply", revision)).toMatchObject({
          state: "failed",
          notDispatched: true,
        });
        expect(native.calls).toEqual([]);
        await work.publish(
          key,
          "rooms",
          [
            {
              path: ["writeIntent", "rooms.partition"],
              value: { edit: { value: { view: partition.view } } },
            },
          ],
          revision,
        );
        const recoveryRevision = (await work.read(key, "rooms"))!.revision;
        expect(
          await submit("partition-plan", "rooms.partition.preview", recoveryRevision),
        ).toMatchObject({
          state: "succeeded",
          result: { evidence: { regions: unreadableRooms } },
        });
        expect(await submit("partition", "rooms.partition", recoveryRevision)).toMatchObject({
          state: "succeeded",
        });
        expect(native.calls).toEqual([
          expect.objectContaining({
            key: "rooms.partition",
            input: expect.objectContaining({ replacing: unreadableRooms }),
          }),
        ]);
        return;
      }
      if (changed === "foreign") {
        const refusal = {
          state: "failed",
          notDispatched: true,
          refusal: { kind: "domain", code: "rooms.selection-missing" },
        };
        expect(preview).toMatchObject(refusal);
        expect(await submit("foreign-sheet-apply", "sheet.apply", revision)).toMatchObject({
          state: "failed",
          notDispatched: true,
        });
        const draw = nativeRecordingRequest("fresh-rooms.draw");
        for (const [command, intent] of [
          ["rooms.partition", { view: foreign }],
          ["rooms.draw", { view: foreign, loops: draw.loops }],
          ["rooms.merge", { view: partition.view, regions: [a, regionCode(foreign)] }],
        ] as const) {
          const current = (await work.read(key, "rooms"))!.revision;
          await work.publish(
            key,
            "rooms",
            [{ path: ["writeIntent", command], value: { edit: { value: intent } } }],
            current,
          );
          const staged = (await work.read(key, "rooms"))!.revision;
          expect(await submit(`${command}-plan`, `${command}.preview`, staged)).toMatchObject(
            refusal,
          );
          expect(await submit(`${command}-apply`, command, staged)).toMatchObject({
            state: "failed",
            notDispatched: true,
          });
        }
        expect(native.calls).toEqual([]);
        return;
      }
      expect(preview).toMatchObject({ state: "succeeded" });
      expect(native.calls).toEqual([]);
      // Pea's write asks nobody (ADR 0038); Work that moved after its preview refuses it at admission.
      if (changed === "selected" || changed === "unrelated")
        await work.publish(
          key,
          "rooms",
          [{ path: ["name", changed === "selected" ? a : b, "edit", "value"], value: "newer" }],
          revision,
        );
      const receipt = await submit("write", "sheet.apply", revision, {
        kind: "pea",
        context: "rooms-recorded",
        thread: run.thread,
        run,
        root: run,
      });
      if (changed !== "selected" && changed !== "unrelated")
        expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded" });
      else {
        expect(receipt).toMatchObject({
          state: "failed",
          notDispatched: true,
          refusal: { kind: "stale_revision" },
        });
        expect(native.calls).toEqual([]);
        const latest = (await work.read(key, "rooms"))!.revision;
        expect(await submit("fresh-preview", "sheet.plan", latest)).toMatchObject({
          state: "succeeded",
        });
        expect(await submit("fresh-write", "sheet.apply", latest)).toMatchObject({
          state: "succeeded",
        });
      }
      expect(native.calls.map((call) => call.key)).toEqual(["rooms.write"]);
      const current = roomsWork.schema.parse((await work.read(key, "rooms"))!.doc);
      for (const [index, key] of [a, b].entries())
        expect(current.name[key]?.edit ?? null).toEqual(
          (changed === "selected" || changed === "unrelated") &&
            index === (changed === "selected" ? 0 : 1)
            ? expect.objectContaining({ value: "newer" })
            : null,
        );
      const values = regions.map((region) => ({
        uniqueId: region.uniqueId,
        name:
          (changed === "selected" || changed === "unrelated") &&
          region.uniqueId === regions[changed === "selected" ? 0 : 1]!.uniqueId
            ? "newer"
            : region.name,
      }));
      expect(native.calls[0]).toMatchObject({ action: "sheet.apply", input: { regions: values } });
    } finally {
      runs.closeAll();
      bindControl({ runs: undefined });
      await native.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("a room field under a key that is no region is refused by Work before any native write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-rooms-invalid-"));
  const native = await fixtureNative(
    join(directory, "native"),
    "fresh-takeoffs.initialize-carrier",
    "fresh-rooms.write",
  );
  const socket = await native.connect();
  let state: unknown;
  const work = withRoomsSheet(
    new RouteWorkspace({
      publicationAuthor: () => "human",
      registrations: [{ spec: roomsWork }],
      store: {
        getState: async () => state,
        setState: async ({ value }) => {
          state = value;
        },
      },
    }),
  );
  const key = { binding: "address" as const, target: address("C:/model.rvt"), route: "rooms" };
  try {
    // A region is keyed by its SubjectRef: Work refuses any other key, so no command ever derives it.
    const published = await work.publish(
      key,
      "rooms",
      [{ path: ["name", "invalid-guid"], value: { edit: { value: "Authored room" } } }],
      0,
    );
    expect(published).toMatchObject({
      ok: false,
      hint: expect.stringContaining("name.invalid-guid"),
    });
    expect((await work.read(key, "rooms"))?.revision ?? 0).toBe(0);
    expect(native.calls).toEqual([]);
  } finally {
    await native.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("foreign Rooms Work is refused by real action admission before native preparation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-rooms-foreign-"));
  const native = await fixtureNative(join(directory, "native"));
  const socket = await native.connect();
  let state: unknown;
  const workspace = withRoomsSheet(
    new RouteWorkspace({
      publicationAuthor: () => "human",
      registrations: [{ spec: roomsWork }],
      store: {
        getState: async () => state,
        setState: async ({ value }) => {
          state = value;
        },
      },
    }),
  );
  const key = { binding: "address" as const, route: "rooms", target: address("C:/another.rvt") };
  try {
    await workspace.publish(
      key,
      "rooms",
      [
        {
          path: [
            "name",
            regionCode(nativeRecordingRequest("fresh-rooms.write").regions[0].uniqueId),
          ],
          value: { edit: { value: "Intent" } },
        },
      ],
      0,
    );
    const response = await native.actions({ workspace, marks: testDocumentMarks(native.bridge) })({
      id: "foreign",
      key: "sheet.plan",
      target: { kind: "document", ref: socket.target },
      input: { work: { key, revision: 1 } },
    });
    expect(response.status).toBeLessThan(400);
    expect(await native.journal.wait("foreign")).toMatchObject({
      state: "failed",
      notDispatched: true,
      refusal: { code: "work.target" },
    });
    expect(native.calls).toEqual([]);
  } finally {
    await native.close();
    await rm(directory, { recursive: true, force: true });
  }
});
