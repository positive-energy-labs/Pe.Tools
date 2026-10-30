import {
  actionReceiptSchema,
  applyPatches,
  bindWork,
  memberWork,
  readingKey,
  readingRequestSchema,
  routeDocDelta,
  settingsCandidate,
  settingsRouteState,
  workKey,
  workWriteSchema,
  type ActionAdmission,
  type ActionReceipt,
  type ReadingRequest,
  type SettingsRouteDocument,
  type RouteStateWriteResult,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import type { Readings } from "#/readings";
import { DEMO_PODS, DEMO_RUN } from "#/route/seeds";

/** Only the host boundary is substituted: graph mount, sources, verbs and undo are production. */
export class PodsHostFixture {
  id = crypto.randomUUID();
  member = { pod: `pods-${this.id}`, path: "settings/model.json" };
  other = { pod: this.member.pod, path: "settings/other.json" };
  key = bindWork("pods", null, memberWork(this.member));
  raw = '{"width":1}';
  sha256 = "a".repeat(64);
  revision = 1;
  doc: SettingsRouteDocument = settingsRouteState.schema.parse({
    basis: { member: this.member, rawContent: this.raw, sha256: this.sha256 },
  });
  writes: WorkWriteAck[] = [];
  actions: ActionReceipt[] = [];
  calls: { key: string; request: Record<string, unknown> }[] = [];
  activations: unknown[] = [];
  workRequests: ReadingRequest[] = [];
  invalid = false;
  pluginEnabled = true;
  subscriptions = new Map<
    symbol,
    { request: ReadingRequest; emit(): void; event(value: unknown): void }
  >();
  get pods() {
    return [
      {
        ...DEMO_PODS[0]!,
        id: this.member.pod,
        name: "Fixture pod",
        diagnostics: [],
        members: [
          { path: this.member.path, sha256: this.sha256, schema: null },
          { path: this.other.path, sha256: "b".repeat(64), schema: null },
          { path: "src/tool.cs", sha256: "c".repeat(64), schema: null },
        ],
      },
    ];
  }
  plugins = () => [
    { id: `pod:${this.member.pod}`, status: this.pluginEnabled ? "active" : "disabled" },
  ];
  emit(kind: ReadingRequest["kind"]) {
    for (const sub of this.subscriptions.values()) if (sub.request.kind === kind) sub.emit();
  }
  value(request: ReadingRequest) {
    if (request.kind === "host-status") return { bridgeIsConnected: false };
    if (request.kind === "work") {
      this.workRequests.push(request);
      return workKey(request) === workKey(this.key)
        ? { doc: this.doc, revision: this.revision }
        : { doc: null, revision: null };
    }
    if (request.kind === "work-acks") return null;
    return undefined;
  }
  resources: Readings = {
    dirty: () => {},
    subscribe: (request, accept) => {
      const id = Symbol();
      const emit = () => {
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
  async write(write: WorkWrite, trusted = false): Promise<RouteStateWriteResult> {
    const before = this.doc;
    const result = applyPatches(
      settingsRouteState,
      { version: 1, revision: this.revision, doc: before },
      "human",
      write.patches,
      write.expectedRevision,
      trusted,
      write.kind === "restore",
    );
    if (!result.ok) return result;
    this.doc = result.envelope.doc;
    this.revision = result.envelope.revision;
    const ack: WorkWriteAck = {
      key: this.key,
      kind: trusted ? "publish" : write.kind,
      by: "human",
      press: write.press,
      base: write.expectedRevision,
      revision: this.revision,
      patches: routeDocDelta(before, this.doc),
      inverse: routeDocDelta(this.doc, before),
      undoable: !trusted,
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
      const call = body as { key: string; request: Record<string, unknown> };
      this.calls.push(call);
      if (call.key === "pod.list") return Response.json({ pods: this.pods, unreadable: [] });
      if (call.key === "pod.member.read")
        return Response.json({
          content: call.request.path === this.member.path ? this.raw : '{"other":true}',
          sha256: call.request.path === this.member.path ? this.sha256 : "b".repeat(64),
        });
      if (call.key === "pod.member.compose")
        return Response.json({
          sha256: this.sha256,
          schemaUrl: null,
          schemaJson: null,
          composed: null,
          source: {
            id: this.member.pod,
            path: call.request.path,
            sha256: this.sha256,
            bytesBase64: "e30=",
            origin: "SuppliedDraft",
          },
          diagnostics: this.invalid
            ? [
                {
                  code: "fixture.invalid-width",
                  path: "/width",
                  severity: "error",
                  message: "Width is invalid",
                },
              ]
            : [],
          dependencies: [],
          schemaValidation: this.invalid ? "failed" : "passed",
          semanticValidation: "not-run",
        });
      if (call.key === "pod.runs")
        return Response.json({
          runs: [
            {
              ...DEMO_RUN,
              receipt: {
                ...DEMO_RUN.receipt!,
                podId: this.member.pod,
                memberPath: this.member.path,
                memberSha256: this.sha256,
              },
            },
          ],
        });
    }
    if (url.pathname === "/pe/plugins") return Response.json(this.plugins());
    if (url.pathname === "/pe/plugin-routes") return Response.json([]);
    if (url.pathname.startsWith("/pe/plugins/") && init?.method === "PUT") {
      this.activations.push(body);
      this.pluginEnabled = body.enabled === true;
      return Response.json(this.plugins());
    }
    if (url.pathname === "/pe/route-state/pods/apply")
      return Response.json(await this.write(workWriteSchema.parse(body)));
    if (url.pathname === "/actions" && init?.method === "POST") {
      const admission = body as unknown as ActionAdmission;
      const request = admission.input as {
        destination?: { pod: string; path: string };
        member?: { pod: string; path: string };
        sha256?: string;
      };
      let result: unknown = {};
      const originalRevision = this.revision;
      if (admission.key === "settings.observe") {
        await this.write(
          {
            kind: "apply",
            press: null,
            expectedRevision: this.revision,
            patches: [
              {
                path: ["basis"],
                value: { member: request.member, sha256: this.sha256, rawContent: this.raw },
              },
              { path: ["fields"], value: {} },
            ],
          },
          true,
        );
        result = { envelope: { doc: this.doc, revision: this.revision } };
      }
      if (admission.key === "settings.write") {
        if (!request.destination) {
          this.raw = settingsCandidate(this.doc.basis!.rawContent, this.doc.fields);
          this.sha256 = "d".repeat(64);
          await this.write(
            {
              kind: "apply",
              press: null,
              expectedRevision: this.revision,
              patches: [
                {
                  path: ["basis"],
                  value: { member: this.member, rawContent: this.raw, sha256: this.sha256 },
                },
                { path: ["fields"], value: {} },
              ],
            },
            true,
          );
        }
        result = { file: { ...(request.destination ?? this.member), sha256: "d".repeat(64) } };
      }
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
              handle: { key: this.key, revision: originalRevision },
              paths: [["basis"], ["fields"]],
            },
            expected: this.doc,
          },
        ],
        effects: [],
        startedAt: "2026-10-30T04:01:00Z",
        result,
      });
      this.actions.push(receipt);
      return Response.json(receipt);
    }
    if (url.pathname === "/actions")
      return Response.json(
        url.searchParams.has("id")
          ? this.actions.filter((receipt) => receipt.id === url.searchParams.get("id"))
          : this.actions,
      );
    throw Error(`Unexpected Pods fixture request ${url.pathname}`);
  };
  moveDisk() {
    this.raw = '{"width":9}';
    this.sha256 = "e".repeat(64);
  }
}
