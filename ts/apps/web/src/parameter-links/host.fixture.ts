import {
  actionReceiptSchema,
  address,
  applyPatches,
  bindWork,
  familyCaptureSchema,
  parameterLinksBasis,
  parameterLinksRouteState,
  readingKey,
  readingRequestSchema,
  routeDocDelta,
  workWriteSchema,
  type ActionAdmission,
  type ActionReceipt,
  type FamilyCapture,
  type ParameterLinkProfile,
  type ReadingRequest,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import type { Readings } from "#/readings";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";

/** Explicit deterministic fixture. It is never registered as a route seed or a demo lane. */
export class ParameterLinksHostFixture {
  id = crypto.randomUUID();
  target = { session: `parameter-links-${this.id}`, openId: "links-document" };
  address = address(`C:/Models/ParameterLinks-${this.id}.rvt`);
  key = bindWork("parameter-links", this.address, undefined, this.target);
  profile: ParameterLinkProfile = {
    formatVersion: 1,
    definitions: [
      {
        id: "supply-flow",
        sourceCategoryId: -2001140,
        sourceParameter: { name: "Flow" },
        sourceScope: "instanceThenType",
        relationship: "sameElement",
        targetParameter: { name: "Design Flow" },
        reducer: "first",
      },
    ],
    assignments: [
      {
        id: "supply-elements",
        definitionId: "supply-flow",
        enabled: true,
        sourceElementUniqueIds: ["terminal-1"],
      },
    ],
  };
  doc = parameterLinksRouteState.schema.parse({ profile: { edit: { value: this.profile } } });
  revision = 1;
  captures: FamilyCapture[] = [];
  actions: ActionReceipt[] = [];
  reads: Record<string, unknown>[] = [];
  writes: WorkWriteAck[] = [];
  writeRequests: WorkWrite[] = [];
  optionRequests: Extract<ReadingRequest, { kind: "field-options" }>[] = [];
  subscriptions = new Set<{ request: ReadingRequest; emit(): void; event(value: unknown): void }>();
  captureNumber = 0;
  conflictOnWrite = false;

  capture(evaluate = true, subject: "edit" | "suggestion" = "edit") {
    const capture = familyCaptureSchema.parse({
      id: (++this.captureNumber).toString(16).padStart(64, "0"),
      key: this.key,
      capturedAt: "2026-10-29T12:00:00Z",
      provenance: { kind: "live", target: this.target },
      reading: {
        kind: "parameter-links",
        value: {
          basis: parameterLinksBasis(this.doc, subject),
          workRevision: this.revision,
          evaluated: evaluate,
          subject,
          stored: this.profile,
          status: {
            hasStoredProfile: true,
            updaterRegistered: true,
            activeDefinitionCount: 1,
            activeAssignmentCount: 1,
          },
          evaluation: evaluate
            ? {
                writes: [],
                issues: [],
                changedWriteCount: 0,
                sourceElementCount: 1,
                targetElementCount: 1,
              }
            : null,
          profileChanged: false,
          appliedWriteCount: 0,
        },
      },
    });
    this.captures.unshift(capture);
    this.emit("family-readings");
    return capture;
  }
  emit(kind: ReadingRequest["kind"]) {
    for (const subscription of this.subscriptions)
      if (subscription.request.kind === kind) subscription.emit();
  }
  value(request: ReadingRequest): unknown {
    if (request.kind === "machine")
      return machineFixture([
        {
          session: this.target.session,
          documents: [
            {
              openId: this.target.openId,
              title: "Parameter Links fixture",
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
                title: "Parameter Links fixture",
                address: this.address,
                isFamilyDocument: false,
              },
            ],
          },
        ],
      };
    if (request.kind === "work") return { doc: this.doc, revision: this.revision };
    if (request.kind === "family-readings") return this.captures;
    if (request.kind === "receipts") return this.actions;
    if (request.kind === "host-status") return { bridgeIsConnected: true };
    if (request.kind === "field-options") {
      this.optionRequests.push(request);
      return {
        items:
          request.key === "category-ids"
            ? [{ value: "-2001140", label: "Air Terminals" }]
            : request.key === "element-unique-ids"
              ? [{ value: "terminal-1", label: "SA-1" }]
              : [
                  {
                    value: "flow",
                    label: "Flow",
                    metadata: {
                      key: "name:Flow",
                      name: "Flow",
                      kind: "NameFallback",
                      storageType: "Double",
                      dataTypeId: "autodesk.spec:airFlow",
                    },
                  },
                ],
      };
    }
    return undefined;
  }
  resources: Readings = {
    dirty: () => {},
    subscribe: (request, accept) => {
      const subscription = {
        request,
        emit: () => {
          const value = this.value(request);
          if (value !== undefined) accept({ kind: "snapshot", key: readingKey(request), value });
        },
        event: (value: unknown) => accept({ kind: "event", key: readingKey(request), value }),
      };
      this.subscriptions.add(subscription);
      subscription.emit();
      return () => {
        this.subscriptions.delete(subscription);
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
  async write(write: WorkWrite) {
    this.writeRequests.push(write);
    if (this.conflictOnWrite) {
      this.conflictOnWrite = false;
      this.revision++;
    }
    const before = this.doc;
    const result = applyPatches(
      parameterLinksRouteState,
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
    for (const subscription of this.subscriptions)
      if (subscription.request.kind === "work-acks") subscription.event(ack);
    return { ok: true as const, revision: this.revision, write: ack };
  }
  fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://fixture");
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (url.pathname === "/family/readings" && init?.method === "POST") {
      this.reads.push(body);
      const request = body.input as { evaluate: boolean; subject?: "edit" | "suggestion" };
      return Response.json(this.capture(request.evaluate, request.subject));
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
        consumes: [],
        effects: [],
        startedAt: "2026-10-29T12:01:00Z",
        result: { executionContext: this.target, native: { receipts: [], diagnostics: [] } },
      });
      this.actions.push(receipt);
      this.emit("receipts");
      return Response.json(receipt);
    }
    if (url.pathname === "/actions") return Response.json(this.actions);
    if (
      url.pathname === "/pe/route-state/parameter-links/apply" ||
      url.pathname === "/pe/route-state/parameter-links/restore"
    )
      return Response.json(await this.write(workWriteSchema.parse(body)));
    throw Error(`Unexpected Parameter Links fixture request ${url.pathname}`);
  };
}
