import {
  actionReceiptSchema,
  address,
  applyPatches,
  bindWork,
  readingKey,
  routeDocDelta,
  takeoffObservationSchema,
  takeoffsRouteState,
  workKey,
  workWriteSchema,
  type ActionAdmission,
  type ActionReceipt,
  type ReadingRequest,
  type WorkWrite,
  type WorkWriteAck,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { takeoffSeeds, DEMO_CANDIDATES } from "./seeds";

/** Only the host transport is replaced; the real route owns acquisition, verbs and undo. */
export class TakeoffHostFixture {
  id = crypto.randomUUID();
  target = { session: `takeoffs-${this.id}`, openId: "takeoff-A" };
  address = address(`C:/Models/Takeoff-${this.id}.rvt`);
  key = bindWork("takeoffs", this.address, undefined, this.target);
  doc = takeoffsRouteState.schema.parse({});
  revision = 1;
  observation = takeoffObservationSchema.parse(
    structuredClone(takeoffSeeds.partition.readings.snapshot),
  );
  writes: WorkWriteAck[] = [];
  actions: ActionReceipt[] = [];
  requests: { key: string; request: Record<string, unknown>; headers: Headers }[] = [];
  subscriptions = new Map<
    symbol,
    { request: ReadingRequest; emit(): void; event(value: unknown): void }
  >();
  fileVersion = "version-A";
  ownerCrop: "Inside" | "Outside" = "Inside";
  workRequests: ReadingRequest[] = [];
  constructor() {
    if (this.observation.kind !== "ready") throw Error("The fixture requires a capture");
    this.observation.target = this.target;
    this.observation.capture.provenance.target = this.target;
    this.observation.capture.snapshot.reading.at = this.address;
  }
  get capture() {
    if (this.observation.kind !== "ready") throw Error("The fixture requires a capture");
    return this.observation.capture;
  }
  emit(kind: ReadingRequest["kind"]) {
    for (const sub of this.subscriptions.values()) if (sub.request.kind === kind) sub.emit();
  }
  value(request: ReadingRequest): unknown {
    if (request.kind === "machine")
      return machineFixture([
        {
          session: this.target.session,
          documents: [
            {
              openId: this.target.openId,
              address: this.address,
              title: "Takeoff fixture",
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
            sessionId: this.target.session,
            openDocumentCount: 1,
            openDocuments: [
              {
                openId: this.target.openId,
                address: this.address,
                title: "Takeoff fixture",
                isFamilyDocument: false,
              },
            ],
          },
        ],
      };
    if (request.kind === "work") {
      this.workRequests.push(request);
      return workKey(request) === workKey(this.key) ||
        (request.binding === "workspace" && request.work === this.capture.id)
        ? { doc: this.doc, revision: this.revision }
        : { doc: null, revision: null };
    }
    if (request.kind === "takeoff-reading") return this.observation;
    if (request.kind === "takeoff-saved")
      return [
        {
          id: this.capture.id,
          capturedAt: this.capture.capturedAt,
          provenance: this.capture.provenance,
          document: this.address,
          title: "Saved fixture",
        },
      ];
    if (request.kind === "rhvac-file-version")
      return { path: request.path, fileVersion: this.fileVersion };
    if (request.kind === "receipts") return this.actions;
    if (request.kind === "host-status") return { bridgeIsConnected: true };
    return undefined;
  }
  source = () => {
    // The EventSource instance owns its lifecycle; the fixture owns the host state.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fixture = this;
    return class {
      onmessage: ((event: { data: string }) => void) | null = null;
      onopen: (() => void) | null = null;
      closed = false;
      ids: symbol[] = [];
      constructor(url: string) {
        queueMicrotask(() => {
          if (this.closed) return;
          this.onopen?.();
          for (const request of JSON.parse(
            new URL(url).searchParams.get("keys") ?? "[]",
          ) as ReadingRequest[]) {
            const id = Symbol();
            const key = readingKey(request);
            const emit = () => {
              const value = fixture.value(request);
              if (value !== undefined && !this.closed)
                this.onmessage?.({ data: JSON.stringify({ kind: "snapshot", key, value }) });
            };
            fixture.subscriptions.set(id, {
              request,
              emit,
              event: (value) =>
                this.onmessage?.({ data: JSON.stringify({ kind: "event", key, value }) }),
            });
            this.ids.push(id);
            emit();
          }
        });
      }
      close() {
        this.closed = true;
        for (const id of this.ids) fixture.subscriptions.delete(id);
      }
      addEventListener() {}
      removeEventListener() {}
    };
  };
  async write(write: WorkWrite): Promise<RouteStateWriteResult> {
    const before = this.doc;
    const result = applyPatches(
      takeoffsRouteState,
      { version: 1, revision: this.revision, doc: before },
      "human",
      write.patches,
      write.expectedRevision,
      false,
      write.kind === "restore",
    );
    if (!result.ok) return result;
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
    this.emit("work");
    for (const sub of this.subscriptions.values())
      if (sub.request.kind === "work-acks") sub.event(ack);
    return { ok: true, revision: this.revision, write: ack };
  }
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://fixture");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.pathname === "/call") {
      this.requests.push({ ...body, headers: new Headers(init?.headers) });
      if (body.key === "takeoffs.candidates")
        return Response.json({
          regions: DEMO_CANDIDATES.map((region, i) => ({
            ...region,
            elementId: i + 101,
            ownerCrop: this.ownerCrop,
          })).filter((region) => region.view === body.request.view),
        });
      if (body.key === "revit.context.view-image")
        return Response.json({
          imageUrl: null,
          registration: null,
          registrationRefusal: "NoImage",
        });
      if (body.key === "takeoffs.snapshot") {
        this.emit("takeoff-reading");
        return Response.json(this.capture.snapshot);
      }
      if (body.key === "rhvac.launch") return Response.json({ launched: true });
      if (body.key === "rhvac.open") return Response.json({ path: body.request.path });
    }
    if (url.pathname === "/takeoffs/observations")
      return Response.json(
        url.searchParams.has("text")
          ? { path: "capture.json", text: "  { malformed source text\n" }
          : this.capture,
      );
    if (
      url.pathname === "/pe/route-state/takeoffs/apply" ||
      url.pathname === "/pe/route-state/takeoffs/restore"
    )
      return Response.json(await this.write(workWriteSchema.parse(body)));
    if (url.pathname === "/actions" && init?.method === "POST") {
      const admission = body as ActionAdmission;
      const receipt = actionReceiptSchema.parse({
        ...admission,
        caller: { kind: "human", via: "local" },
        basis: { kind: "human" },
        state: "succeeded",
        steps: [],
        prepared: { state: "ready", value: admission.input },
        recovery: [],
        consumes: [],
        effects: [],
        startedAt: "2026-10-30T04:00:00Z",
        result: {},
      });
      this.actions.push(receipt);
      this.emit("receipts");
      return Response.json(receipt);
    }
    if (url.pathname === "/actions")
      return Response.json(
        url.searchParams.has("id")
          ? this.actions.filter((row) => row.id === url.searchParams.get("id"))
          : this.actions,
      );
    throw Error(`Unexpected takeoff fixture request: ${url.pathname} ${JSON.stringify(body)}`);
  };
}
