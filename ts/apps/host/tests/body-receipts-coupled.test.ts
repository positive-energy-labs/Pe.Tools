import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { HostNativeRead, canonicalJson } from "@pe/host-internal/native-read";
import {
  BODY_RECEIPT_HEADER,
  DUCTS_BODY_VERSION_HEADER,
  address,
  bindWork,
  readingKey,
  type ReadingRequest,
} from "@pe/agent-contracts";
import { identityCodecs } from "../../../packages/agent-contracts/src/route-kernel-codecs.ts";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { fansInputRoutes } from "../src/app.ts";
import { HostInputContext } from "../src/input-context.ts";
import { HostFiles } from "../src/host-files.ts";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { HostSessionInventory } from "../src/session-inventory.ts";
import { DuctsReadings } from "../src/ducts-readings.ts";
import { FIRM_SEED } from "../src/ducts-inputs.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { mintBrowserContext } from "../src/control.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { nativeCatalogIdentity, openRecordingWriter } from "../src/native-recording.ts";
import { HostInputReadSets, defaultReadSetLimits } from "../src/input-occurrence.ts";
import { admitNativeCaller } from "../src/native-read-policy.ts";
import { settle } from "./effect-test.ts";

const ref = { session: "receipt-session", openId: "receipt-open" };
const addressValue = address("C:/Models/receipt.rvt");
const document = identityCodecs.document.encode({ document: addressValue });
if (!document.ok) throw Error("bad document");
const doc = document.value;
const actualTarget = {
  processIncarnation: { pid: 42, startedAt: 1000 },
  openDocumentLifetime: { openId: ref.openId },
};
const identity = { build: "receipt-coupled", catalog: nativeCatalogIdentity() };
const base = "http://127.0.0.1:51519";
const snapshotPath =
  process.env.PE_RECEIPT_SNAPSHOT ??
  "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-health.json";
const snapshotRaw = JSON.parse(readFileSync(snapshotPath, "utf8").replace(/^\uFEFF/, ""));
const snapshot = Schema.decodeUnknownSync(Schema.Json)(snapshotRaw.result ?? snapshotRaw);

async function setup(mode = "normal") {
  const dir = await mkdtemp(join(tmpdir(), "pe-body-receipts-"));
  await mkdir(join(dir, "catalogs"));
  await writeFile(join(dir, "firm.json"), JSON.stringify(FIRM_SEED));
  const writer = await settle(
    openRecordingWriter(join(dir, "bundle"), identity, {
      maxBytes: 64 * 1024 * 1024,
      maxTakings: mode === "full" ? 1 : 2048,
    }),
  );
  if (mode === "metadata") {
    const layer = HostInputReadSets.layer.bind(HostInputReadSets);
    vi.spyOn(HostInputReadSets, "layer").mockImplementation((lane) =>
      layer(lane, { ...defaultReadSetLimits, metadataBytesPerRoot: 1 }),
    );
  }
  if (mode === "io") await writeFile(join(dir, "bundle", "read-sets"), "blocked-directory");
  const inputs = await settle(
    HostInputContext.pipe(
      Effect.provide(HostInputContext.layer({ kind: "live", captureStore: writer })),
    ),
  );
  let nativeCount = 0;
  const native = Layer.succeed(HostNativeRead, {
    resolve: (input) =>
      admitNativeCaller(input.key).pipe(
        Effect.as({
          operationKey: input.key,
          ...actualTarget,
          ...(input.key === "ducts.tables"
            ? { openDocumentLifetime: { kind: "session-only" as const } }
            : {}),
          normalizedInput: canonicalJson(input.input as Schema.Json),
          freshnessGeneration: "receipt-g1",
          representation: "overview" as const,
        }),
      ),
    read: (input) =>
      admitNativeCaller(input.key).pipe(
        Effect.map(() => ({
          value:
            input.key === "ducts.tables"
              ? {
                  folder: "test",
                  tables: {},
                  missing: (input.input as { ids: string[] }).ids,
                  unsupported: {},
                }
              : snapshot,
          nativeRequestId: `receipt-native-${++nativeCount}`,
          actualTarget:
            input.key === "ducts.tables"
              ? { ...actualTarget, openDocumentLifetime: { kind: "session-only" as const } }
              : actualTarget,
          freshness: { freshnessGeneration: "receipt-g1" },
          cost: {},
          outcome: "committed" as const,
        })),
      ),
  });
  const live = {
    owner: new DuctsReadings(),
    native,
    files: HostFiles.layer({ firm: join(dir, "firm.json"), catalogs: join(dir, "catalogs") }),
    marks: Layer.succeed(
      HostDocumentMarks,
      hostMarks({ observedSince: 1, changedAt: () => 2, subscribe: () => () => {} }),
    ),
    inventory: Layer.succeed(HostSessionInventory, {
      list: () => Effect.die("no inventory list"),
      subscribe: () => () => {},
      document: () => Effect.succeed({ ...ref, address: addressValue }),
      session: () => Effect.succeed({ sessionId: ref.session }),
      attachment: () => Effect.succeed({ sessionId: ref.session }),
    }),
  };
  const admission = requestIdentityLayer({
    port: () => 51519,
    frontendOrigin: Effect.succeed(undefined),
    share: {
      read: async () => {
        throw Error("local test never reads sharing");
      },
      observe: () => {},
    },
  });
  const web = HttpRouter.toWebHandler(
    fansInputRoutes(inputs, {
      live,
      store: fileRouteDocumentStore(join(dir, "work")),
      initialize: async (workspace) => {
        workspace.register({
          spec: {
            route: "receipt-test",
            title: "Receipt",
            description: "Receipt Work",
            schema: z.object({ count: z.number().default(0) }).prefault({}),
          },
        });
        await workspace.apply(
          bindWork("receipt-test", addressValue, undefined, ref),
          "receipt-test",
          "human",
          [],
          0,
        );
        for (const route of ["fans", "ducts"])
          await workspace.apply(
            bindWork(route, addressValue, undefined, ref),
            route,
            "human",
            [],
            0,
          );
      },
    }).pipe(Layer.provide(admission)),
    { disableLogger: true },
  );
  const cookie = mintBrowserContext({ kind: "local" }).split(";")[0]!;
  const otherCookie = mintBrowserContext({ kind: "local" }).split(";")[0]!;
  const send = (path: string, body?: unknown, credential = cookie, extraHeaders: Record<string, string> = {}) =>
    web.handler(
      new Request(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          host: "127.0.0.1:51519",
          origin: base,
          referer: `${base}/fans`,
          cookie: credential,
          [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
          [HOST_RPC_BRIDGE_SESSION_HEADER]: ref.session,
          [HOST_RPC_DOCUMENT_HEADER]: ref.openId,
          "content-type": "application/json",
        ...extraHeaders,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return {
    writer,
    send,
    otherCookie,
    close: async () => {
      await web.dispose();
      vi.restoreAllMocks();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test.each(["metadata", "full", "io"])(
  "faithful %s capture bound preserves the exact retained live body without a claim",
  async (mode) => {
    const owner = await setup(mode);
    try {
      const response = await owner.send("/call", { key: "ducts.snapshot.roster", request: {} });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(JSON.stringify(await response.json())).toBe(JSON.stringify(snapshot));
      expect(response.headers.get(BODY_RECEIPT_HEADER)).toBeNull();
      expect(owner.writer.capture.truncated()).not.toBeNull();
    const refused = await owner.send("/call", { key: "ducts.snapshot.roster", request: {} }, undefined, { [DUCTS_BODY_VERSION_HEADER]: "missing-version" });
    expect(refused.status, await refused.clone().text()).toBe(409);
    expect(refused.headers.get(BODY_RECEIPT_HEADER)).toBeNull();
    } finally {
      await owner.close();
    }
  },
);

test("actual HTTP bodies authenticate multi-body mounted ACKs into point-bound native takings", async () => {
  const owner = await setup();
  let stream: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const roster = await owner.send("/call", { key: "ducts.snapshot.roster", request: {} });
    let rosterReceipt = roster.headers.get(BODY_RECEIPT_HEADER);
    expect(roster.status, await roster.clone().text()).toBe(200);
    expect(JSON.stringify(await roster.json())).toBe(JSON.stringify(snapshot));
    expect(rosterReceipt).toBeTruthy();
    const warm = await owner.send("/call", { key: "ducts.snapshot.roster", request: {} });
    expect(warm.headers.get("x-pe-ducts-reused")).toBe("true");
    expect(warm.headers.get(BODY_RECEIPT_HEADER)).toBeTruthy();
    expect(warm.headers.get(BODY_RECEIPT_HEADER)).not.toBe(rosterReceipt);
    rosterReceipt = warm.headers.get(BODY_RECEIPT_HEADER); await warm.body?.cancel();
    const tables = await owner.send("/call", { key: "ducts.tables", request: { ids: ["CD3-1"] } });
    const tablesReceipt = tables.headers.get(BODY_RECEIPT_HEADER);
    expect(tablesReceipt).toBeTruthy();
    await tables.body?.cancel();
    const opened = await owner.send("/pe/resources?connection=receipt-coupled");
    stream = opened.body!.getReader();
    await stream.read();
    const consumer = { instance: "pane-main", reading: "overview", argsHash: "args-overview" };
    const accepted = [{ document: doc, consumer, bodyReceipts: [rosterReceipt!, tablesReceipt!] }];
    const ack = (body: unknown, cookie?: string) =>
      owner.send("/pe/resource-subscriptions?connection=receipt-coupled", body, cookie);
    expect((await ack({ add: [], remove: [], accepted }, owner.otherCookie)).status).toBe(400);
    expect(owner.writer.points.ids()).toHaveLength(0);
    expect(
      (
        await ack({
          add: [],
          remove: [],
          accepted: [{ ...accepted[0], bodyReceipts: [rosterReceipt! + "tamper"] }],
        })
      ).status,
    ).toBe(400);
    expect(owner.writer.points.ids()).toHaveLength(0);
    const response = await ack({ add: [], remove: [], accepted });
    expect(response.status, await response.clone().text()).toBe(200);
    const point = await settle(owner.writer.points.get(owner.writer.points.ids()[0]!));
    const root = await settle(owner.writer.readSets.get(point.bindings[0]!.readSetId));
    expect(root.recipe.key).toBe("accepted.reading");
    expect(Object.keys(root.dependencies).filter((key) => key.startsWith("body:"))).toHaveLength(2);
    const bodies = await Promise.all(
      Object.values(root.dependencies).map((id) => settle(owner.writer.readSets.get(id))),
    );
    expect(bodies.map((body) => body.recipe.key)).toContain("native.call");
    const refs = await import("../src/recording-points.ts");
    const proof = await settle(refs.recordingReadSetReferences(owner.writer, doc, root.id));
    const nativeIds = [...proof.ids]
      .map((id) => owner.writer.taking(id)!)
      .filter((taking) => taking.input.kind === "native")
      .map((taking) =>
        taking.outcome.kind === "answered" ? taking.outcome.nativeRequestId : "refused",
      );
    expect(nativeIds).toEqual(expect.arrayContaining(["receipt-native-1", "receipt-native-2"]));
    const peRoster = await owner.send("/pe/ducts/roster", { target: ref });
    expect(peRoster.status, await peRoster.clone().text()).toBe(200);
    const peRosterReceipt = peRoster.headers.get(BODY_RECEIPT_HEADER);
    expect(peRosterReceipt).toBeTruthy();
    const rosterBody = await peRoster.json();
    const fan =
      rosterBody.rows.find((row: { unitId: number }) => row.unitId === 14577391) ??
      rosterBody.rows[0];
    const sheet = await owner.send("/pe/ducts/sheet", {
      target: ref,
      mode: "fan",
      unitId: fan.unitId,
      portIndex: fan.portIndex,
    });
    expect(sheet.status, await sheet.clone().text()).toBe(200);
    expect(sheet.headers.get(BODY_RECEIPT_HEADER)).toBeTruthy();
    await sheet.body?.cancel();
    const workGet = await owner.send(
      "/pe/route-state/receipt-test?binding=address&target=" + encodeURIComponent(addressValue),
    );
    expect(workGet.status, await workGet.clone().text()).toBe(200);
    expect(workGet.headers.get(BODY_RECEIPT_HEADER)).toBeTruthy();
    await workGet.body?.cancel();
    const workReading: ReadingRequest = {
      kind: "work",
      ...bindWork("receipt-test", addressValue, undefined, ref),
    };
    const envelopeReading: ReadingRequest = {
      kind: "ducts-snapshot",
      target: ref,
      selector: { kind: "roster" },
    };
    expect((await ack({ add: [workReading, envelopeReading], remove: [] })).status).toBe(200);
    let text = "";
    const frames: { kind: string; key: string; bodyReceipts?: string[] }[] = [];
    while (
      !frames.some((frame) => frame.key === readingKey(workReading)) ||
      !frames.some((frame) => frame.key === readingKey(envelopeReading))
    ) {
      text += new TextDecoder().decode((await stream.read()).value);
      let end: number;
      while ((end = text.indexOf("\n\n")) >= 0) {
        const record = text.slice(0, end);
        text = text.slice(end + 2);
        const data = record.split("\n").find((line) => line.startsWith("data:"));
        if (data) frames.push(JSON.parse(data.slice(5)));
      }
    }
    const workFrame = frames.find((frame) => frame.key === readingKey(workReading))!;
    expect(workFrame.kind, JSON.stringify(workFrame)).toBe("snapshot");
    expect(workFrame.bodyReceipts).toHaveLength(1);
    expect(
      frames.find((frame) => frame.key === readingKey(envelopeReading))!.bodyReceipts,
    ).toBeUndefined();
    const workConsumer = { instance: "pane-work", reading: "work", argsHash: "work-args" };
    const bodySet = [
      peRosterReceipt!,
      sheet.headers.get(BODY_RECEIPT_HEADER)!,
      workGet.headers.get(BODY_RECEIPT_HEADER)!,
    ];
    const all = [
      ...accepted,
      {
        document: doc,
        consumer: workConsumer,
        bodyReceipts: [...bodySet, ...workFrame.bodyReceipts!],
      },
    ];
    const acceptedAll = await ack({ add: [], remove: [], accepted: all });
    expect(acceptedAll.status, await acceptedAll.clone().text()).toBe(200);
    const latest = await settle(owner.writer.points.get(owner.writer.points.ids().at(-1)!));
    expect(latest.bindings).toHaveLength(2);
    const workBinding = latest.bindings.find((binding) => binding.instance === "pane-work")!;
    const workProof = await settle(
      refs.recordingReadSetReferences(owner.writer, doc, workBinding.readSetId),
    );
    expect([...workProof.ids].some((id) => owner.writer.taking(id)!.input.kind === "marks")).toBe(
      true,
    );
    expect([...workProof.ids].some((id) => owner.writer.taking(id)!.input.kind === "work")).toBe(
      true,
    );
    const foreign = identityCodecs.document.encode({ document: "C:/Models/foreign.rvt" });
    if (!foreign.ok) throw Error("bad foreign document");
    expect(
      (await ack({ add: [], remove: [], accepted: [{ ...accepted[0], document: foreign.value }] }))
        .status,
    ).toBe(400);
    expect(
      (await ack({ add: [], remove: [], accepted: Array.from({ length: 33 }, () => accepted[0]) }))
        .status,
    ).toBe(400);
    expect(
      (
        await ack({
          add: [],
          remove: [],
          accepted: [{ ...accepted[0], bodyReceipts: ["x".repeat(16384)] }],
        })
      ).status,
    ).toBe(400);
    expect(owner.writer.capture.truncated()).toBeNull();
    expect((await ack({ add: [], remove: [], unmounted: [consumer] })).status).toBe(200);
    expect((await ack({ add: [], remove: [], accepted })).status).toBe(200);
    await stream.cancel();
    stream = undefined;
    expect((await ack({ add: [], remove: [], accepted })).status).toBe(409);
  } finally {
    await stream?.cancel();
    await owner.close();
  }
}, 45000);

test("unmount fences in-flight sealing while a later mounted acceptance can return", async () => {
  const owner = await setup();
  let stream: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  try {
    const body = await owner.send("/call", { key: "ducts.snapshot.roster", request: {} });
    const receipt = body.headers.get(BODY_RECEIPT_HEADER)!;
    expect(receipt).toBeTruthy();
    await body.body?.cancel();
    const opened = await owner.send("/pe/resources?connection=receipt-race");
    stream = opened.body!.getReader();
    await stream.read();
    const consumer = { instance: "race-pane", reading: "roster", argsHash: "race-args" };
    const accepted = [{ document: doc, consumer, bodyReceipts: [receipt] }];
    const keep = owner.writer.readSets.keep;
    vi.spyOn(owner.writer.readSets, "keep").mockImplementation((record) =>
      record.recipe.key === "accepted.reading"
        ? Effect.andThen(
            Effect.promise(() => {
              entered.resolve();
              return release.promise;
            }),
            keep(record),
          )
        : keep(record),
    );
    const pending = owner.send("/pe/resource-subscriptions?connection=receipt-race", {
      add: [],
      remove: [],
      accepted,
    });
    await entered.promise;
    expect(
      (
        await owner.send("/pe/resource-subscriptions?connection=receipt-race", {
          add: [],
          remove: [],
          unmounted: [consumer],
        })
      ).status,
    ).toBe(200);
    release.resolve();
    expect((await pending).status).toBe(400);
    expect(owner.writer.points.ids()).toHaveLength(0);
    expect(owner.writer.capture.truncated()).toBeNull();
    expect(
      (
        await owner.send("/pe/resource-subscriptions?connection=receipt-race", {
          add: [],
          remove: [],
          accepted,
        })
      ).status,
    ).toBe(200);
    expect(owner.writer.points.ids()).toHaveLength(1);
  } finally {
    release.resolve();
    await stream?.cancel();
    await owner.close();
  }
}, 30000);
