import {
  actionReceiptSchema,
  address,
  applyPatches,
  bindWork,
  readingKey,
  readingRequestSchema,
  roomsRouteState,
  routeDocDelta,
  workWriteSchema,
  type ActionAdmission,
  type ActionReceipt,
  type ReadingRequest,
  type RoomsRouteDocument,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { DEMO_ROOMS, DEMO_VIEW } from "./demo";

/** Transport fixture: real kernel target resolution, Work acknowledgement, review and undo. */
export class RoomsHostFixture {
  id = crypto.randomUUID();
  target = { session: `rooms-${this.id}`, openId: "document-A" };
  address = address(`C:/Models/Rooms-${this.id}.rvt`);
  key = bindWork("rooms", this.address, undefined, this.target);
  doc: RoomsRouteDocument = roomsRouteState.schema.parse({});
  revision = 1;
  snapshot = structuredClone(DEMO_ROOMS);
  writes: WorkWriteAck[] = [];
  actions: ActionReceipt[] = [];
  calls: { key: string; request: unknown; headers: Headers }[] = [];
  subscriptions = new Map<
    symbol,
    { request: ReadingRequest; emit(): void; event(value: unknown): void }
  >();

  value(request: ReadingRequest): unknown {
    if (request.kind === "machine")
      return machineFixture([
        {
          session: this.target.session,
          documents: [
            {
              openId: this.target.openId,
              title: "Rooms",
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
                title: "Rooms",
                address: this.address,
                isFamilyDocument: false,
              },
            ],
          },
        ],
      };
    if (request.kind === "work") return { doc: this.doc, revision: this.revision };
    if (request.kind === "receipts") return this.actions;
    if (request.kind === "host-status") return { bridgeIsConnected: true };
    return undefined;
  }
  emit(kind: ReadingRequest["kind"]) {
    for (const sub of this.subscriptions.values()) if (sub.request.kind === kind) sub.emit();
  }
  source = () => {
    const valueOf = (request: ReadingRequest) => this.value(request);
    const subscriptions = this.subscriptions;
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
            const send = (frame: unknown) => {
              if (!this.closed) this.onmessage?.({ data: JSON.stringify(frame) });
            };
            const emit = () => {
              const value = valueOf(request);
              if (value !== undefined) send({ kind: "snapshot", key: readingKey(request), value });
            };
            subscriptions.set(id, {
              request,
              emit,
              event: (value) => send({ kind: "event", key: readingKey(request), value }),
            });
            this.ids.push(id);
            emit();
          }
        });
      }
      close() {
        this.closed = true;
        for (const id of this.ids) subscriptions.delete(id);
      }
    };
  };
  write(write: WorkWrite) {
    const before = this.doc;
    const result = applyPatches(
      roomsRouteState,
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
  fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://fixture");
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (url.pathname === "/call") {
      this.calls.push({
        key: String(body.key),
        request: body.request,
        headers: new Headers(init?.headers),
      });
      if (body.key === "rooms.snapshot") return Response.json(this.snapshot);
      if (body.key === "rooms.trace")
        return Response.json(
          { error: { message: `traced no zone on ${DEMO_VIEW}` } },
          { status: 404 },
        );
      if (body.key === "revit.context.view-image")
        return Response.json({ registration: null, imageUrl: null, registrationRefusal: "NoCrop" });
    }
    if (url.pathname === "/actions" && init?.method === "POST") {
      const admission = body as unknown as ActionAdmission;
      const value =
        admission.key === "rooms.partition"
          ? { zones: 1, created: 2, kept: 1, locked: 1, deleted: 0, held: 1, failures: [] }
          : admission.key === "rooms.merge"
            ? { guid: "merged-room", merged: ["fixture-1", "fixture-2"], sqft: 480 }
            : {};
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
              paths: admission.key === "rooms.write" ? [["edits"]] : [["marks"]],
            },
            expected: this.doc,
          },
        ],
        effects: [{ kind: "document", ref: this.target }],
        startedAt: "2026-10-29T22:00:00Z",
        result: { value, target: this.target },
      });
      this.actions.push(receipt);
      this.emit("receipts");
      return Response.json(receipt);
    }
    if (url.pathname === "/actions")
      return Response.json(
        url.searchParams.has("id")
          ? this.actions.filter((receipt) => receipt.id === url.searchParams.get("id"))
          : this.actions,
      );
    if (url.pathname === "/pe/route-state/rooms/salvage") return Response.json(null);
    if (
      url.pathname === "/pe/route-state/rooms/apply" ||
      url.pathname === "/pe/route-state/rooms/restore"
    )
      return Response.json(this.write(workWriteSchema.parse(body)));
    throw Error(`Unexpected Rooms fixture request ${url.pathname}`);
  };
}
