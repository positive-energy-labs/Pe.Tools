import {
  actionReceiptSchema,
  applyPatches,
  bindWork,
  ductsRouteState,
  readingKey,
  readingRequestSchema,
  routeDocDelta,
  workWriteSchema,
  DUCTS_BODY_VERSION_HEADER,
  type ActionAdmission,
  type ActionReceipt,
  type DuctsReadingRequest,
  type ReadingRequest,
  type DuctsRouteDocument,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import type { ReadingWorkerRequest, ReadingWorkerResponse } from "#/shell/readings-worker";
import { pricingJob, type PricingPayload, type PricingResult } from "./pricing-job";
import { snapshot as baseSnapshot } from "./test-fixture";
import sheetFixture from "./sheet/sheet.fixture.json";

/** Only transport stands in: real parsers, patch authority, pricing and kernel remain in the test. */
export class DuctsHostFixture {
  snapshot = structuredClone(baseSnapshot);
  doc: DuctsRouteDocument = ductsRouteState.schema.parse({
    flows: { "4": { edit: { value: { cfm: 100, source: "override" } } } },
  });
  revision = 1;
  writes: WorkWriteAck[] = [];
  actions: ActionReceipt[] = [];
  requests: { key: string; request: Record<string, unknown> }[] = [];
  pricingRequests: ReadingWorkerRequest<PricingPayload>[] = [];
  subscriptions = new Map<
    symbol,
    { request: ReadingRequest; emit(): void; event(value: unknown): void }
  >();
  bodies = new Map<string, string>();
  key = bindWork("ducts", null, undefined, { session: "s", openId: "d" });
  sequence = 0;
  prefix = crypto.randomUUID();
  failSheetDetail = false;
  snapshotFailure: string | null = null;
  version(request: DuctsReadingRequest) {
    const key = readingKey(request);
    let version = this.bodies.get(key);
    if (!version)
      this.bodies.set(key, (version = `ducts-host-fixture-${this.prefix}-${++this.sequence}`));
    return version;
  }
  emitWork() {
    for (const sub of this.subscriptions.values()) if (sub.request.kind === "work") sub.emit();
  }
  invalidate() {
    for (const key of this.bodies.keys())
      this.bodies.set(key, `ducts-host-fixture-${this.prefix}-${++this.sequence}`);
    for (const sub of this.subscriptions.values())
      if (sub.request.kind === "ducts-snapshot" || sub.request.kind === "ducts-tables") sub.emit();
  }
  value(request: ReadingRequest): unknown {
    if (request.kind === "machine")
      return machineFixture([
        {
          session: "s",
          documents: [
            {
              openId: "d",
              title: "Duct route slice",
              address: null,
              isFamilyDocument: false,
              isActive: true,
            },
          ],
        },
      ]);
    if (request.kind === "inventory")
      return {
        sessions: [
          {
            connected: true,
            sessionId: "s",
            openDocumentCount: 1,
            openDocuments: [
              { openId: "d", title: "Duct route slice", address: null, isFamilyDocument: false },
            ],
          },
        ],
      };
    if (request.kind === "work") return { doc: this.doc, revision: this.revision };
    if (request.kind === "receipts") return this.actions;
    if (request.kind === "ducts-snapshot" || request.kind === "ducts-tables")
      return {
        state: "ready",
        revision: this.version(request),
        version: this.version(request),
        session: request.kind === "ducts-snapshot" ? request.target.session : request.session,
        target: request.kind === "ducts-snapshot" ? request.target : null,
      };
    return undefined;
  }
  source = () => {
    const host = this;
    return class {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      closed = false;
      ids: symbol[] = [];
      constructor(url: string) {
        queueMicrotask(() => {
          if (this.closed) return;
          this.onopen?.();
          for (const raw of JSON.parse(new URL(url).searchParams.get("keys")!) as unknown[]) {
            const request = readingRequestSchema.parse(raw);
            const id = Symbol();
            this.ids.push(id);
            const send = (frame: object) => {
              if (!this.closed)
                this.onmessage?.({ data: JSON.stringify({ key: readingKey(request), ...frame }) });
            };
            const emit = () => {
              const value = host.value(request);
              if (value !== undefined) send({ kind: "snapshot", value });
            };
            const event = (value: unknown) => send({ kind: "event", value });
            host.subscriptions.set(id, { request, emit, event });
            if (request.kind === "work-acks") for (const ack of host.writes) event(ack);
            emit();
          }
        });
      }
      close() {
        this.closed = true;
        for (const id of this.ids) host.subscriptions.delete(id);
      }
    };
  };
  worker = (() => {
    const requests = this.pricingRequests;
    return class {
      onmessage: ((event: { data: ReadingWorkerResponse<PricingResult, never> }) => void) | null =
        null;
      onerror: ((event: { message: string }) => void) | null = null;
      stopped = false;
      run = pricingJob();
      postMessage(request: ReadingWorkerRequest<PricingPayload>) {
        requests.push(request);
        queueMicrotask(() => {
          if (this.stopped) return;
          const result = this.run({ id: request.id, ...request.input });
          if ("delta" in result) throw Error("Unexpected delta");
          this.onmessage?.({ data: structuredClone(result) });
        });
      }
      terminate() {
        this.stopped = true;
      }
    };
  })();
  fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://fixture");
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (url.pathname === "/pe/ducts/catalogs") return Response.json({ tables: {}, findings: [] });
    if (url.pathname === "/pe/ducts/roster")
      return Response.json({ ...sheetFixture.roster, target: { session: "s", openId: "d" } });
    if (url.pathname === "/pe/ducts/sheet") {
      this.requests.push({ key: "sheet", request: body });
      const detail = body.detail as { kind: string; pathId?: string } | undefined;
      if (detail && this.failSheetDetail)
        return Response.json(
          { error: { code: "bridge", message: "Stale sheet basis; read a new overview" } },
          { status: 409 },
        );
      const base = { target: { session: "s", openId: "d" }, basis: sheetFixture.overview.basis };
      if (!detail) return Response.json({ ...sheetFixture.overview, ...base });
      if (detail.kind === "inputs") return Response.json({ ...sheetFixture.inputs, ...base });
      if (detail.kind === "elements") return Response.json({ ...sheetFixture.elements, ...base });
      if (detail.kind === "worksheet")
        return Response.json({
          ...base,
          kind: "worksheet",
          limits: { supplyFpm: 900, returnFpm: 700, source: "SHIM placeholder" },
          supply: { runs: [], sections: [], worstKnownInWg: null, elementSections: {} },
          return: { runs: [], sections: [], worstKnownInWg: null, elementSections: {} },
          legs: {},
        });
      return Response.json({ ...base, kind: "legs", pathId: detail.pathId, legs: [] });
    }
    if (url.pathname === "/actions" && init?.method === "POST") {
      const admission = body as unknown as ActionAdmission;
      const preview = admission.key.includes("preview-");
      const row = actionReceiptSchema.parse({
        ...admission,
        caller: { kind: "human", via: "local" },
        basis: { kind: "human" },
        effects:
          preview || admission.key === "ducts.refresh"
            ? []
            : [{ kind: "document", ref: { session: "s", openId: "d" } }],
        state: "succeeded",
        steps: [],
        prepared: { state: "ready", value: admission.input },
        recovery: [],
        startedAt: "2026-10-29T23:00:00Z",
        result: {
          value: {
            previewOnly: preview,
            counts: {
              planned: preview ? 1 : 0,
              written: preview ? 0 : 1,
              refused: 0,
              unchanged: 0,
            },
            writes: [
              {
                kind: "terminal-flow",
                id: 4,
                outcome: preview ? "planned" : "written",
                after: "100",
              },
            ],
            systemsAfter: [],
            storeRevision: preview ? 0 : 1,
          },
        },
      });
      this.actions.push(row);
      if (admission.key === "ducts.refresh") this.invalidate();
      return Response.json(row);
    }
    if (url.pathname === "/actions")
      return Response.json(
        url.searchParams.has("id")
          ? this.actions.filter((row) => row.id === url.searchParams.get("id"))
          : this.actions,
      );
    if (
      url.pathname === "/pe/route-state/ducts/apply" ||
      url.pathname === "/pe/route-state/ducts/restore"
    ) {
      const write = workWriteSchema.parse(body);
      const before = this.doc;
      const result = applyPatches(
        ductsRouteState,
        { version: 1, revision: this.revision, doc: before },
        "human",
        write.patches,
        write.expectedRevision,
        false,
        write.kind === "restore",
      );
      if (!result.ok) return Response.json(result);
      this.doc = result.envelope.doc;
      this.revision = result.envelope.revision;
      const ack: WorkWriteAck = {
        key: this.key,
        kind: write.kind,
        by: "human",
        press: write.press,
        base: write.expectedRevision,
        revision: this.revision,
        patches: routeDocDelta(before, this.doc),
        inverse: routeDocDelta(this.doc, before),
        undoable: true,
      };
      this.writes.push(ack);
      this.emitWork();
      for (const sub of this.subscriptions.values())
        if (sub.request.kind === "work-acks") sub.event(ack);
      return Response.json({ ok: true, revision: this.revision, write: ack });
    }
    if (url.pathname === "/call") {
      const headers = new Headers(init?.headers);
      const session = headers.get(HOST_RPC_BRIDGE_SESSION_HEADER)!;
      const openId = headers.get(HOST_RPC_DOCUMENT_HEADER);
      const request = (body.request ?? {}) as Record<string, unknown>;
      const key = String(body.key);
      this.requests.push({ key, request });
      if (key === "ducts.snapshot" && this.snapshotFailure) throw Error(this.snapshotFailure);
      const subject = readingRequestSchema.parse(
        key === "ducts.snapshot"
          ? { kind: "ducts-snapshot", target: { session, openId }, ...request }
          : { kind: "ducts-tables", session, ids: request.ids },
      ) as DuctsReadingRequest;
      const version = this.version(subject);
      return Response.json(
        key === "ducts.snapshot" ? this.snapshot : { tables: {}, missing: [], unsupported: {} },
        {
          headers: {
            "x-pe-resolved-session": session,
            ...(openId ? { "x-pe-resolved-open-id": encodeURIComponent(openId) } : {}),
            "x-pe-native-request-id": `native-${version}`,
            [DUCTS_BODY_VERSION_HEADER]: version,
            "x-pe-ducts-reused": "true",
          },
        },
      );
    }
    // Picture captures are a separate explicit lane; ordinary demand receives no geometry fixture.
    throw Error(`Unexpected fake-host request ${url.pathname}`);
  };
}
