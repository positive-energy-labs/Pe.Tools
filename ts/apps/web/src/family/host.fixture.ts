import {
  actionReceiptSchema,
  address,
  applyPatches,
  bindWork,
  familyCaptureSchema,
  familyDraftRouteState,
  readingKey,
  readingRequestSchema,
  routeDocDelta,
  workKey,
  workWriteSchema,
  OLDER_WORK as UNREADABLE_WORK,
  type ActionAdmission,
  type ActionReceipt,
  type FamilyDraft,
  type ReadingRequest,
  type RouteStateWriteResult,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import type { Readings } from "#/readings";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { FAMILY_MODEL_SCHEMA } from "./graph";

/** Only host transport/persistence is substituted. The route, sources, verbs and journal are real. */
export class FamilyHostFixture {
  id = crypto.randomUUID();
  target = { session: `family-${this.id}`, openId: "family-A" };
  address = address(`C:/Families/Family-${this.id}.rfa`);
  key = bindWork("family", this.address, undefined, this.target);
  cell = "/types/Standard/Model";
  raw = JSON.stringify({
    family: {
      name: "Test family",
      category: "Mechanical Equipment",
      template: "Mechanical Equipment.rft",
      placement: "LevelBased",
    },
    parameters: { Model: { dataType: "Text", value: "Original" } },
    types: { Standard: { Model: "Original type" } },
  });
  doc: FamilyDraft = familyDraftRouteState.schema.parse({
    reading: this.raw,
    takenAt: "2026-10-30T04:00:00Z",
  });
  revision = 1;
  sourceMember = { pod: "family-pod", path: "settings/family/model.json", sha256: "a".repeat(64) };
  capturedMember = {
    pod: "family-pod",
    path: "settings/family/new-capture.json",
    sha256: "c".repeat(64),
  };
  saved = familyCaptureSchema.parse({
    id: "b".repeat(64),
    key: this.key,
    capturedAt: "2026-10-30T04:00:00Z",
    provenance: { kind: "file" },
    reading: {
      kind: "spec",
      value: { jobId: "fixture-job", fileName: "cut-sheet.pdf", pages: [], blocks: [], images: [] },
    },
  });
  writes: WorkWriteAck[] = [];
  actions: ActionReceipt[] = [];
  reads: Record<string, unknown>[] = [];
  readFailure: string | null = null;
  workRequests: ReadingRequest[] = [];
  unreadable = false;
  workFailure: string | null = null;
  subscriptions = new Map<
    symbol,
    { request: ReadingRequest; emit(): void; event(value: unknown): void }
  >();
  value(request: ReadingRequest): unknown {
    const doc = {
      openId: this.target.openId,
      title: "Family",
      address: this.address,
      isFamilyDocument: true,
      isActive: true,
    };
    if (request.kind === "machine")
      return machineFixture([{ session: this.target.session, documents: [doc] }]);
    if (request.kind === "inventory")
      return {
        sessions: [
          {
            connected: true,
            sessionId: this.target.session,
            openDocumentCount: 1,
            openDocuments: [doc],
          },
        ],
      };
    if (request.kind === "work") {
      this.workRequests.push(request);
      return workKey(request) === workKey(this.key)
        ? { doc: this.doc, revision: this.revision }
        : { doc: null, revision: null };
    }
    if (request.kind === "receipts")
      return request.id ? this.actions.filter((row) => row.id === request.id) : this.actions;
    if (request.kind === "host-status") return { bridgeIsConnected: true };
    if (request.kind === "family-readings") return [this.saved];
    return undefined;
  }
  emit(kind: ReadingRequest["kind"]) {
    for (const sub of this.subscriptions.values()) if (sub.request.kind === kind) sub.emit();
  }
  resources: Readings = {
    dirty: () => {},
    subscribe: (request, accept) => {
      const id = Symbol();
      const emit = () => {
        if (request.kind === "work" && (this.unreadable || this.workFailure)) {
          this.workRequests.push(request);
          return accept({
            kind: "failure",
            key: readingKey(request),
            error: this.workFailure ?? UNREADABLE_WORK,
          });
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
          for (const raw of JSON.parse(new URL(url).searchParams.get("keys")!) as unknown[])
            this.releases.push(
              resources.subscribe(readingRequestSchema.parse(raw), (frame) => {
                if (!this.closed) this.onmessage?.({ data: JSON.stringify(frame) });
              }),
            );
        });
      }
      close() {
        this.closed = true;
        for (const release of this.releases.splice(0)) release();
      }
    };
  };
  write = async (write: WorkWrite): Promise<RouteStateWriteResult> => {
    const before = this.doc;
    const result = applyPatches(
      familyDraftRouteState,
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
  };
  fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://fixture");
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (url.pathname === "/call") {
      if (body.key === "pod.list")
        return Response.json({
          pods: [
            {
              id: this.sourceMember.pod,
              name: "Family pod",
              members: [
                {
                  path: this.sourceMember.path,
                  sha256: this.sourceMember.sha256,
                  schema: FAMILY_MODEL_SCHEMA,
                },
              ],
            },
          ],
        });
      if (body.key === "pod.member.read")
        return Response.json({ content: this.raw, sha256: this.sourceMember.sha256 });
      if (body.key === "pod.member.compose")
        return Response.json({ composed: this.raw, dependencies: [], diagnostics: [] });
    }
    if (url.pathname === "/pe/family-spec")
      return Response.json({
        path: "spec/cut-sheet.json",
        jobId: "fixture-job",
        fileName: "cut-sheet.pdf",
        pages: [],
        blocks: [],
        images: [],
      });
    if (url.pathname === "/family/readings") {
      this.reads.push(body);
      if (this.readFailure) return Response.json({ error: this.readFailure }, { status: 409 });
      return Response.json(this.saved);
    }
    if (url.pathname === "/actions" && init?.method === "POST") {
      const admission = body as unknown as ActionAdmission;
      const plan = {
        id: `plan-${this.id}`,
        executionContext: this.target,
        plan: {
          familyId: 0,
          familyName: "Test family",
          planHash: "sealed-family",
          changes: [],
          runEffects: [],
          refusals: [],
          warnings: [],
        },
        included: { "0": "sealed-family" },
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
              paths: [["cells"], ["reading"]],
            },
            expected: this.doc,
          },
        ],
        effects: [],
        startedAt: "2026-10-30T04:01:00Z",
        result:
          admission.key === "family.plan"
            ? plan
            : admission.key === "family.capture"
              ? { executionContext: this.target, member: this.capturedMember }
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
    if (
      url.pathname === "/pe/route-state/family/apply" ||
      url.pathname === "/pe/route-state/family/restore"
    )
      return Response.json(await this.write(workWriteSchema.parse(body)));
    if (url.pathname === "/pe/route-state/family/start-fresh") {
      const before = this.doc;
      const base = this.revision;
      this.doc = familyDraftRouteState.schema.parse({});
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
        aside: "family-aside",
      };
      this.writes.push(ack);
      this.emit("work");
      return Response.json({ ok: true, revision: this.revision, write: ack });
    }
    throw Error(`Unexpected Family fixture request ${url.pathname}`);
  };
}
