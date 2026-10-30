import {
  actionReceiptSchema,
  address,
  applyPatches,
  bindWork,
  familiesRouteState,
  familyCellKey,
  readingKey,
  readingRequestSchema,
  routeDocDelta,
  workKey,
  workWriteSchema,
  UNREADABLE_WORK,
  type ActionAdmission,
  type ActionReceipt,
  type FamiliesRouteDocument,
  type ReadingRequest,
  type RouteStateWriteResult,
  type WorkKey,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import type { MountScope } from "#/shell/mount";
import type { Readings } from "#/readings";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { DEMO_FAMILIES } from "./seeds";
import type { FamiliesObservation } from "./sources";

/** Host transports only are fake; graph admission, source assembly, Work and journals run unchanged. */
export class FamiliesHostFixture {
  id = crypto.randomUUID();
  target = { session: `families-${this.id}`, openId: "document-A" };
  address = address(`C:/Models/Families-${this.id}.rvt`);
  key = bindWork("families", this.address, undefined, this.target);
  filter = {
    categoryNames: ["Mechanical Equipment"],
    familyNames: [],
    placementScope: "AllLoaded" as const,
  };
  cell = familyCellKey({
    familyName: "Fan Coil Unit - Ducted",
    typeName: "FCU-1",
    parameter: "PE_G___Model",
  });
  doc: FamiliesRouteDocument = familiesRouteState.schema.parse({
    scope: { edit: { value: this.filter } },
    takenAt: "2026-10-30T02:00:00Z",
    cells: { [this.cell]: { edit: { value: { value: "Edited model", storageType: "String" } } } },
  });
  revision = 1;
  reading: FamiliesObservation = {
    id: `completed-${this.id}`,
    work: this.key,
    document: this.target,
    filter: this.filter,
    capturedAt: "2026-10-30T02:00:00Z",
    completedAt: "2026-10-30T02:00:00Z",
    progress: {
      runId: crypto.randomUUID(),
      state: "complete",
      phase: "complete",
      completed: 1,
      total: 1,
      workers: 1,
    },
    result: { families: [DEMO_FAMILIES[0]!], issues: [], page: null },
  };
  stored = new Map<string, { reading: FamiliesObservation; records: string[] | null }>();
  recordBodies = new Map<string, Promise<Response>>();
  writes: WorkWriteAck[] = [];
  writeRequests: { key: WorkKey; write: WorkWrite }[] = [];
  actions: ActionReceipt[] = [];
  reads: Record<string, unknown>[] = [];
  cancels: string[] = [];
  workRequests: ReadingRequest[] = [];
  catalogHeaders: Headers[] = [];
  scopeListeners = new Set<() => void>();
  current = this.target;
  readGate?: (body: Record<string, unknown>) => Promise<FamiliesObservation>;
  salvage: unknown = null;
  unreadable = false;
  subscriptions = new Map<
    symbol,
    { request: ReadingRequest; emit(): void; event(value: unknown): void }
  >();

  constructor() {
    this.save(this.reading);
  }
  save(reading: FamiliesObservation, records: string[] | null = null) {
    this.reading = reading;
    this.stored.set(reading.id, { reading, records });
    this.emit("families-matrix");
  }
  emit(kind: ReadingRequest["kind"]) {
    for (const sub of this.subscriptions.values()) if (sub.request.kind === kind) sub.emit();
  }
  notify() {
    for (const notify of this.scopeListeners) notify();
  }
  move(openId: string) {
    this.current = { ...this.target, openId };
    this.notify();
  }
  snapshot = (): MountScope<FamiliesRouteDocument> => ({
    target: { kind: "document", ref: this.current },
    work: {
      handle: {
        key: bindWork(
          "families",
          this.current.openId === this.target.openId
            ? this.address
            : address(`C:/Models/B-${this.id}.rvt`),
          undefined,
          this.current,
        ),
        revision: this.current.openId === this.target.openId ? this.revision : 0,
      },
      doc:
        this.current.openId === this.target.openId ? this.doc : familiesRouteState.schema.parse({}),
    },
  });
  value(request: ReadingRequest): unknown {
    if (request.kind === "machine")
      return machineFixture([
        {
          session: this.target.session,
          documents: [
            {
              openId: this.target.openId,
              title: "Families",
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
                title: "Families",
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
        ? this.unreadable
          ? undefined
          : { doc: this.doc, revision: this.revision }
        : { doc: null, revision: null };
    }
    if (request.kind === "families-matrix")
      return request.target.openId === this.target.openId
        ? {
            reading: {
              at: this.address,
              observedAt: this.reading.capturedAt,
              version: this.reading.id,
            },
            bodyVersion: this.reading.id,
          }
        : null;
    if (request.kind === "field-options")
      return { items: [{ value: "Mechanical Equipment", label: "Mechanical Equipment" }] };
    if (request.kind === "receipts") return this.actions;
    if (request.kind === "host-status") return { bridgeIsConnected: true };
    return undefined;
  }
  resources: Readings = {
    dirty: () => {},
    subscribe: (request, accept) => {
      const id = Symbol();
      const emit = () => {
        if (request.kind === "work" && this.unreadable) {
          this.workRequests.push(request);
          return accept({ kind: "failure", key: readingKey(request), error: UNREADABLE_WORK });
        }
        const value = this.value(request);
        if (value !== undefined) accept({ kind: "snapshot", key: readingKey(request), value });
      };
      this.subscriptions.set(id, {
        request,
        emit,
        event: (value) => accept({ kind: "event", key: readingKey(request), value }),
      });
      emit();
      return () => {
        this.subscriptions.delete(id);
      };
    },
  };
  source = () => {
    const resources = this.resources;
    return class {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      closed = false;
      releases: (() => void)[] = [];
      constructor(url: string) {
        queueMicrotask(() => {
          if (this.closed) return;
          this.onopen?.();
          for (const raw of JSON.parse(new URL(url).searchParams.get("keys")!) as unknown[]) {
            this.releases.push(
              resources.subscribe(readingRequestSchema.parse(raw), (frame) => {
                if (!this.closed) this.onmessage?.({ data: JSON.stringify(frame) });
              }),
            );
          }
        });
      }
      close() {
        this.closed = true;
        for (const release of this.releases.splice(0)) release();
      }
    };
  };
  write = async (key: WorkKey, write: WorkWrite): Promise<RouteStateWriteResult> => {
    this.writeRequests.push({ key, write });
    const before = this.doc;
    const result = applyPatches(
      familiesRouteState,
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
      key,
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
    this.notify();
    for (const sub of this.subscriptions.values())
      if (sub.request.kind === "work-acks") sub.event(ack);
    return { ok: true, revision: this.revision, write: ack };
  };
  fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://fixture");
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (url.pathname === "/call") {
      if (body.key === "pod.list") return Response.json({ pods: [] });
      if (body.key === "revit.catalog.loaded-families") {
        this.catalogHeaders.push(new Headers(init?.headers));
        return Response.json({
          families: [
            {
              familyId: 3101,
              familyName: "Fan Coil Unit - Ducted",
              categoryName: "Mechanical Equipment",
              placedInstanceCount: 2,
            },
          ],
        });
      }
    }
    if (url.pathname === "/families/readings") {
      if (init?.method === "DELETE") {
        this.cancels.push(String(body.readId));
        return Response.json({ cancelled: true });
      }
      if (init?.method === "POST") {
        this.reads.push(body);
        const result = this.readGate ? await this.readGate(body) : this.reading;
        return Response.json(result);
      }
      if (url.searchParams.has("record"))
        return (await this.recordBodies.get(url.searchParams.get("record")!)) ?? Response.json({});
      if (url.searchParams.has("id")) {
        const saved = this.stored.get(url.searchParams.get("id")!)!;
        return Response.json(url.searchParams.get("format") === "parts" ? saved : saved.reading);
      }
      return Response.json([{ ...this.reading, familyCount: 1, typeCount: 2, issueCount: 0 }]);
    }
    if (url.pathname === "/actions" && init?.method === "POST") {
      const admission = body as unknown as ActionAdmission;
      const plan = {
        id: `plan-${this.id}`,
        executionContext: this.target,
        plan: [
          {
            familyId: 3101,
            familyName: "Fan Coil Unit - Ducted",
            planHash: "sealed-family",
            changes: [
              {
                section: "parameters",
                key: "PE_G___Model",
                kind: "Update",
                before: "FXMQ15",
                after: "Edited model",
              },
            ],
            runEffects: [],
            refusals: [],
            warnings: [],
          },
        ],
        included: { "3101": "sealed-family" },
      };
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
            probe: {
              handle: { key: this.key, revision: this.revision },
              paths: [["cells"], ["scope"]],
            },
            expected: this.doc,
          },
        ],
        effects: [],
        startedAt: "2026-10-30T02:01:00Z",
        result:
          admission.key === "families.plan"
            ? plan
            : { executionContext: this.target, native: { receipts: [], diagnostics: [] } },
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
    if (url.pathname === "/pe/route-state/families/salvage")
      return Response.json(this.salvage ? { from: "aside-1", value: this.salvage } : null);
    if (url.pathname === "/pe/route-state/families/start-fresh") {
      const before = this.doc;
      const base = this.revision;
      this.doc = familiesRouteState.schema.parse({});
      this.revision++;
      this.unreadable = false;
      const ack: WorkWriteAck = {
        key: this.key,
        kind: "start-fresh",
        by: "human",
        press: null,
        base,
        revision: this.revision,
        patches: [{ path: [], value: this.doc }],
        inverse: [{ path: [], value: before }],
        undoable: false,
        aside: "aside-1",
      };
      this.writes.push(ack);
      this.emit("work");
      return Response.json({ ok: true, revision: this.revision, write: ack });
    }
    if (
      url.pathname === "/pe/route-state/families/apply" ||
      url.pathname === "/pe/route-state/families/restore"
    )
      return Response.json(await this.write(this.key, workWriteSchema.parse(body)));
    throw Error(`Unexpected fake-host request ${url.pathname}`);
  };
}
