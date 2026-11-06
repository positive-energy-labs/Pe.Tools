import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { expect, test, vi } from "vite-plus/test";
import { HostNativeRead, canonicalJson } from "@pe/host-internal/native-read";
import {
  DUCTS_BODY_VERSION_HEADER,
  address,
} from "@pe/agent-contracts";
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
  const dir = await mkdtemp(join(tmpdir(), "pe-capture-continuity-"));
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
    }).pipe(Layer.provide(admission)),
    { disableLogger: true },
  );
  const cookie = mintBrowserContext({ kind: "local" }).split(";")[0]!;
  const send = (path: string, body?: unknown, extraHeaders: Record<string, string> = {}) =>
    web.handler(
      new Request(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          host: "127.0.0.1:51519",
          origin: base,
          referer: `${base}/fans`,
          cookie,
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
    dir,
    send,
    close: async () => {
      await web.dispose();
      vi.restoreAllMocks();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test.each(["metadata", "full", "io"])(
  "faithful %s capture bound preserves the exact retained live body despite ancillary capture failure",
  async (mode) => {
    const owner = await setup(mode);
    try {
      const response = await owner.send("/call", { key: "ducts.snapshot.roster", request: {} });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(JSON.stringify(await response.json())).toBe(JSON.stringify(snapshot));
      expect(owner.writer.capture.truncated()).not.toBeNull();
    const refused = await owner.send("/call", { key: "ducts.snapshot.roster", request: {} }, { [DUCTS_BODY_VERSION_HEADER]: "missing-version" });
    expect(refused.status, await refused.clone().text()).toBe(409);
    } finally {
      await owner.close();
    }
  },
);

