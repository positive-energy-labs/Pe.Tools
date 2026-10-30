import {
  actionReceiptSchema,
  applyPatches,
  bindWork,
  readingKey,
  readingRequestSchema,
  routeDocDelta,
  scheduleCatalogSchema,
  scheduleGridRouteState,
  scheduleReadingSchema,
  workKey,
  workWriteSchema,
  type ActionAdmission,
  type ActionReceipt,
  type ReadingRequest,
  type ScheduleGridDocument,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";

/** Fakes are confined to the host transport. Parsing, writes, mounting and journals stay real. */
export class SchedulesHostFixture {
  id = crypto.randomUUID().replaceAll("-", "");
  target = { session: `schedule-session-${this.id}`, openId: "schedule-document" };
  address = `C:/Projects/Schedules-${this.id}.rvt`;
  workspaceId = `schedule:${this.id}`;
  key = bindWork("schedules", null, this.workspaceId);
  capture = this.id.repeat(2);
  reading = scheduleReadingSchema.parse({
    id: this.capture,
    workspaceId: this.workspaceId,
    target: this.target,
    document: this.address,
    capturedAt: "2026-10-29T23:00:00Z",
    process: { pid: 4242, processStartUtc: "2026-10-29T22:00:00Z", executable: "Revit.exe" },
    snapshot: {
      scheduleId: 42,
      scheduleUniqueId: "schedule-uid-42",
      scheduleName: "Mechanical equipment",
      columns: [
        { columnNumber: 0, headerText: "Tag", fieldName: "Tag" },
        { columnNumber: 1, headerText: "Model", fieldName: "Model" },
      ],
      rows: [
        {
          rowNumber: 1,
          values: ["IU-1", "Old model"],
          subjectIds: [101],
          bindings: [
            {
              columnNumber: 1,
              targetElementIds: [101],
              parameterName: "Model",
              parameterId: 9,
              storageType: "String",
              displayValue: "Old model",
              rawValue: "Old model",
              isEditable: true,
              targets: [
                {
                  elementId: 101,
                  parameterId: 9,
                  storageType: "String",
                  hasValue: true,
                  rawValue: "Old model",
                  isReadOnly: false,
                },
              ],
            },
          ],
        },
      ],
    },
  });
  catalog = scheduleCatalogSchema.parse({
    schedules: [
      {
        scheduleId: 42,
        workspaceId: this.workspaceId,
        name: "Mechanical equipment",
        categoryName: "Equipment",
      },
    ],
  });
  doc: ScheduleGridDocument = scheduleGridRouteState.schema.parse({
    basis: { captureId: this.capture },
    takenAt: this.reading.capturedAt,
    cells: { "1::1": { edit: { value: "New model" } } },
  });
  revision = 1;
  pushResult: {
    applied: number;
    failures: { key: string; error: string }[];
    readback?: unknown;
    readbackError?: string;
  } = {
    applied: 1,
    failures: [],
    readback: this.reading,
  };
  writes: WorkWriteAck[] = [];
  actions: ActionReceipt[] = [];
  workRequests: ReadingRequest[] = [];
  reads: { key: string; input: unknown }[] = [];
  subscriptions = new Map<
    symbol,
    { request: ReadingRequest; emit(): void; event(value: unknown): void }
  >();
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
              title: "Schedules",
              address: this.address,
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
                title: "Schedules",
                address: this.address,
                isFamilyDocument: false,
              },
            ],
          },
        ],
      };
    if (request.kind === "work") {
      this.workRequests.push(request);
      return workKey(request) === workKey(this.key)
        ? { doc: this.doc, revision: this.revision }
        : { doc: null, revision: null };
    }
    if (request.kind === "receipts") return this.actions;
    if (request.kind === "schedule-reading") {
      if (request.subject === "catalog") return this.catalog;
      if (request.subject === "history")
        return [{ id: this.capture, at: this.reading.capturedAt, label: "Mechanical equipment" }];
      if (request.subject === "saved") return request.id === this.capture ? this.reading : null;
      return request.id === this.workspaceId ? this.reading : null;
    }
    if (request.kind === "host-status") return { bridgeIsConnected: true };
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
  fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://fixture");
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (url.pathname === "/call") {
      if (body.key === "pod.list") return Response.json({ pods: [] });
      throw Error(`Unexpected native call ${String(body.key)}`);
    }
    if (url.pathname === "/schedules/readings") {
      this.reads.push({ key: String(body.key), input: body.input });
      if (body.key === "schedule.grid.snapshot") return Response.json(this.reading);
      if (body.key === "schedule.grid.bind")
        return Response.json({ envelope: { version: 1, doc: this.doc, revision: this.revision } });
      throw Error(`Unexpected query ${String(body.key)}`);
    }
    if (url.pathname === "/actions" && init?.method === "POST") {
      const admission = body as unknown as ActionAdmission;
      const receipt = actionReceiptSchema.parse({
        ...admission,
        caller: { kind: "human", via: "local" },
        basis: { kind: "human" },
        state: "succeeded",
        steps: [],
        prepared: { state: "ready", value: admission.input },
        recovery: [],
        consumes: [
          {
            kind: "work",
            probe: { handle: { key: this.key, revision: this.revision }, paths: [["cells"]] },
            expected: this.doc.cells,
          },
        ],
        effects: [{ kind: "document", ref: this.target }],
        startedAt: "2026-10-29T23:01:00Z",
        result: { value: this.pushResult },
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
    if (
      url.pathname === "/pe/route-state/schedules/apply" ||
      url.pathname === "/pe/route-state/schedules/restore"
    ) {
      const write = workWriteSchema.parse(body);
      if (url.searchParams.get("work") !== this.workspaceId)
        throw Error("The kernel targeted another schedule's Work");
      const before = this.doc;
      const result = applyPatches(
        scheduleGridRouteState,
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
      this.emit("work");
      for (const sub of this.subscriptions.values())
        if (sub.request.kind === "work-acks") sub.event(ack);
      return Response.json({ ok: true, revision: this.revision, write: ack });
    }
    throw Error(`Unexpected fake-host request ${url.pathname}`);
  };
}
