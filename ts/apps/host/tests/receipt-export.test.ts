import { receiptGoldenEnvelope } from "../../../packages/agent-contracts/tests/receipt-fixture.ts";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PostHog } from "posthog-node";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { harnessEventSchema, type HarnessEvent, type Receipt } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import {
  projectReceipt,
  createReceiptExport,
  fatalReceipt,
  acceptNativeProducer,
  createThreadReceiptAdapter,
  recordUpdateFact,
  commandCodes,
  admitBuild,
  abortableFetch,
} from "../src/receipt-export.ts";
import { mcpBeforeSend } from "../src/mcp-analytics.ts";
import { foreignAddins } from "../src/foreign-addins.ts";

const stamp = receiptGoldenEnvelope.stamp!;
const r = (body: Receipt["body"]): Receipt => ({
  ...receiptGoldenEnvelope,
  stamp: { ...stamp, component: "host" },
  id: randomUUID(),
  body,
});

test("export command codes match concrete Pe.App command classes and build admission rejects reserved fields", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(dir, entry.name))
        : entry.name.endsWith(".cs")
          ? [join(dir, entry.name)]
          : [],
    );
  const commands = files(join(import.meta.dirname, "../../../../dotnet/Pe.App/Commands")).flatMap(
    (path) =>
      [
        ...readFileSync(path, "utf8").matchAll(
          /^public (?:sealed )?class (\w+)\s*:\s*(?:IExternalCommand|ExternalCommand|ViewPaletteBase|FamilyElementsPaletteBase|ProductLaunchCommand)\b/gm,
        ),
      ].map((m) => m[1]!),
  );
  expect([...commandCodes].sort()).toEqual(commands.sort());
  const metadata = { version: stamp.version, build: stamp.build, commit: stamp.commit };
  expect(admitBuild("host", metadata, stamp.installId, stamp.processSessionId)?.component).toBe(
    "host",
  );
  expect(
    admitBuild("host", { ...metadata, component: "web" }, stamp.installId, stamp.processSessionId),
  ).toBeNull();
  expect(admitBuild("host", metadata, "unknown", stamp.processSessionId)).toBeNull();
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pe-export-"));
  const journal = new ActionJournal(join(dir, "journal.json"), () => stamp);
  const sent: unknown[] = [];
  const exporter = createReceiptExport({
    journal,
    root: dir,
    stamps: { host: { ...stamp, component: "host" }, web: { ...stamp, component: "web" } },
    send: async (e) => {
      sent.push(e);
    },
  });
  return {
    dir,
    journal,
    sent,
    exporter,
    async close() {
      await exporter.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("one allowlist rejects unclosed labels, stamp spoofing, null identity and automatic content", () => {
  expect(
    projectReceipt({ ...r({ kind: "diagnostic", code: "pane.failed" }), stamp: null }),
  ).toBeNull();
  expect(
    projectReceipt(r({ kind: "usage", event: "host_op", counters: { op: "private-model-name" } })),
  ).toBeNull();
  expect(
    projectReceipt(
      r({ kind: "usage", event: "ribbon_click", counters: { commandCode: "authored-pod" } }),
    ),
  ).toBeNull();
  expect(
    projectReceipt(r({ kind: "diagnostic", code: "reading.timeout", readingKind: "private-key" })),
  ).toBeNull();
  const fault = projectReceipt(
    r({ kind: "diagnostic", code: "pane.failed", localRef: { path: "C:/user/private/stack.txt" } }),
  )!;
  expect(JSON.stringify(fault)).not.toContain("private");
  expect(fault.properties).toMatchObject({
    component: "host",
    $exception_fingerprint: ["host", "pane.failed"],
    $process_person_profile: false,
    $geoip_disable: true,
  });
  expect(
    projectReceipt({
      ...r({ kind: "usage", event: "app_boot", counters: {} }),
      body: {
        kind: "usage",
        event: "app_boot",
        counters: { component: "web", doc_title: "private" },
      },
    } as never),
  ).toBeNull();
});

test("a settled action exports its duration, status and a closed fault code, never its error or issues", () => {
  const action = (state: "failed" | "succeeded", error: string) =>
    r({
      kind: "action",
      value: {
        kind: "operation",
        id: "private-action",
        key: "scripting.execute",
        caller: { kind: "human", via: "cli" },
        basis: null,
        destination: { kind: "host" },
        request: { code: "private script" },
        bases: {},
        steps: [],
        preparation: { state: "unprepared" },
        recovery: [],
        startedAt: "2026-10-13T14:59:57.500Z",
        publication: { state: "unrequested" },
        ...(state === "succeeded"
          ? { state, result: { private: true } }
          : {
              state,
              error,
              status: 500,
              issues: [
                { instancePath: "/x", code: "private.code", message: "private", severity: "error" },
              ],
            }),
      },
    });
  const failed = projectReceipt(action("failed", "private stack at C:/private/x.cs"))!;
  expect(failed.event).toBe("host_op");
  expect(failed.properties).toMatchObject({
    op: "scripting.execute",
    outcome: "failed",
    duration_ms: 2500,
    status: 500,
    fault_code: "action.failed",
    origin_class: "human",
  });
  expect(JSON.stringify(failed)).not.toContain("private");
  expect(
    projectReceipt(action("failed", "Error: grant.required: Refused at /call: private"))!.properties
      .fault_code,
  ).toBe("grant.required");
  const ok = projectReceipt(action("succeeded", ""))!.properties;
  expect(ok).toMatchObject({ outcome: "succeeded", duration_ms: 2500 });
  expect(ok).not.toHaveProperty("fault_code");
  expect(ok).not.toHaveProperty("status");
});

test("the host boot fact counts stale Pe.Tools add-in manifests by the product's legacy rule, as counts and years", () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-addins-"));
  try {
    const roots = {
      user: join(dir, "user"),
      machine: join(dir, "machine"),
      programFiles: [join(dir, "pf")],
    };
    const addin = (root: string, year: string, name: string, assembly: string) => {
      mkdirSync(join(root, year), { recursive: true });
      writeFileSync(
        join(root, year, `${name}.addin`),
        `<RevitAddIns><AddIn Type="Application"><Assembly>${assembly}</Assembly></AddIn></RevitAddIns>`,
      );
    };
    addin(roots.user, "2025", "Pe.App", "Pe.App\\Pe.App.dll"); // this install
    addin(roots.user, "2025", "00-Pe.App", "Pe.App\\Pe.Revit.Loader.dll"); // 0.6.x shim
    addin(roots.machine, "2024", "Pe.App", "C:\\private\\old\\Pe.App.dll"); // per-machine 0.5
    addin(roots.user, "2026", "PE_Tools", "PE_Tools\\PE_Tools.dll"); // a legacy name
    addin(roots.user, "2026", "Unrelated", "Unrelated.dll"); // not ours
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../../../product.payloads.json"), "utf8"),
    );
    const counters = foreignAddins(manifest, roots);
    expect(counters).toEqual({ foreignAddinCount: 3, foreignAddinYears: ["2024", "2025", "2026"] });
    const boot = projectReceipt(r({ kind: "usage", event: "app_boot", counters }))!;
    expect(boot.properties).toMatchObject({
      foreign_addin_count: 3,
      foreign_addin_years: ["2024", "2025", "2026"],
    });
    expect(JSON.stringify(boot)).not.toMatch(/private|Pe\.App|PE_Tools|pe-addins/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the actual PostHog client wire carries the original receipt timestamp and only safe diagnostic fields", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-posthog-wire-"));
  const requests: Record<string, unknown>[] = [];
  const client = new PostHog("explicit-test-key", {
    disableCompression: true,
    disableGeoip: true,
    flushInterval: 0,
    fetchRetryCount: 0,
    enableExceptionAutocapture: false,
    fetch: async (_url, options) => {
      requests.push(JSON.parse(String(options.body)) as Record<string, unknown>);
      return new Response("{}", { status: 200 });
    },
  });
  const journal = new ActionJournal(join(dir, "journal.json"));
  const exporter = createReceiptExport({
    journal,
    root: dir,
    client,
    stamps: { host: { ...stamp, component: "host" }, web: null },
  });
  try {
    await exporter.record(
      { kind: "diagnostic", code: "pane.failed", localRef: { path: "C:/PRIVATE_LOCAL_STACK" } },
      receiptGoldenEnvelope.join,
      exporter.stamps.host,
      { id: randomUUID(), at: receiptGoldenEnvelope.at },
    );
    await expect.poll(() => requests.length).toBe(1);
    const event = (
      requests[0]!.batch as {
        timestamp: string;
        distinct_id: string;
        properties: Record<string, unknown>;
      }[]
    )[0]!;
    expect(event.timestamp).toBe(receiptGoldenEnvelope.at);
    expect(event.distinct_id).toBe(stamp.installId);
    expect(event.properties).toMatchObject({
      $geoip_disable: true,
      $process_person_profile: false,
      request_id: receiptGoldenEnvelope.join.requestId,
      $exception_fingerprint: ["host", "pane.failed"],
    });
    expect(JSON.stringify(requests)).not.toMatch(
      /PRIVATE_LOCAL_STACK|doc_title|machine|username|stack_trace_raw/,
    );
  } finally {
    await exporter.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP beforeSend strips nested exception and argument/result content, persists first and exports once", async () => {
  const f = fixture();
  try {
    const hook = mcpBeforeSend(f.exporter, () => receiptGoldenEnvelope.join);
    const event = {
      type: "capture" as const,
      event: "$exception",
      distinct_id: "MACHINE\\user",
      timestamp: "2026-10-13T16:00:00.000Z",
      properties: {
        $mcp_tool_name: "pe_read",
        $mcp_duration_ms: 17,
        $mcp_is_error: true,
        $mcp_input_keys: ["key", "[redacted]"],
        $mcp_parameters: { key: "SECRET INPUT" },
        $mcp_response: "SECRET RESULT",
        $mcp_intent: "SECRET INTENT",
        $mcp_error_message: "SECRET ERROR",
        $exception_list: [
          {
            value: "SECRET",
            stacktrace: { frames: [{ filename: "C:/secret/path", function: "secret" }] },
          },
        ],
        $mcp_client_name: "private-person",
        $mcp_client_version: "private-person",
        $groups: { person: "SECRET" },
        component: "web",
      },
    };
    expect(await hook(event)).toBeNull();
    await expect.poll(() => f.sent.length).toBe(1);
    expect(await f.journal.read({ kinds: ["mcp"] })).toHaveLength(1);
    const exported = f.sent[0] as { properties: Record<string, unknown> };
    expect(JSON.stringify(exported)).not.toMatch(
      /SECRET|MACHINE|private-person|secret\/path|redacted/,
    );
    expect(exported.properties).toMatchObject({
      component: "host",
      $mcp_tool_name: "pe_read",
      $mcp_input_keys: ["key"],
      $mcp_client_name: "other",
      $exception_fingerprint: ["host", "mcp.failed"],
      request_id: receiptGoldenEnvelope.join.requestId,
    });
    expect(await hook({ ...event, event: "$mcp_tools_list" })).toBeNull();
    expect(f.sent).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("native receipt source identity is retained, deduped, and never replaced with the host build", async () => {
  const f = fixture();
  try {
    const fact = {
      schema: 1 as const,
      id: randomUUID(),
      at: "2026-10-13T16:00:00.000Z",
      join: { requestId: randomUUID() },
      body: {
        kind: "usage" as const,
        event: "ribbon_click" as const,
        counters: { commandCode: "CmdPea" },
      },
      emitter: { version: stamp.version, build: stamp.build, commit: stamp.commit },
    };
    const producer = {
      fact,
      connection: {
        sessionId: "private-session",
        processId: 17,
        processStartUtcUnixMs: 1000,
        lane: "dev" as const,
        buildStamp: stamp.build,
      },
    };
    await acceptNativeProducer(f.exporter, producer);
    await acceptNativeProducer(f.exporter, producer);
    const rows = await f.journal.read({ kinds: ["usage"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: fact.id,
      at: fact.at,
      join: fact.join,
      stamp: { component: "revit", build: stamp.build },
    });
    const unknown = {
      ...producer,
      fact: { ...fact, id: randomUUID(), emitter: { ...fact.emitter, build: null } },
    };
    await acceptNativeProducer(f.exporter, unknown);
    expect((await f.journal.read({ kinds: ["usage"] }))[1]!.stamp).toBeNull();
    expect(f.sent).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("thread and update adapters keep opaque joins and honest endings, with notice reply custody local", async () => {
  const f = fixture();
  try {
    const id = "private-thread";
    const events = [
      {
        seq: 1,
        at: "2026-10-13T16:00:00.000Z",
        kind: "prompt" as const,
        turnId: "private-turn",
        text: "private prompt",
      },
      {
        seq: 2,
        at: "2026-10-13T16:00:01.000Z",
        kind: "permission_request" as const,
        turnId: "private-turn",
        requestId: "private-request",
        toolCall: { toolCallId: "private-tool", title: "local approval text" },
        options: [{ optionId: "once", name: "Approve", kind: "allow_once" as const }],
      },
      {
        seq: 3,
        at: "2026-10-13T16:00:02.000Z",
        kind: "permission_resolved" as const,
        turnId: "private-turn",
        requestId: "private-request",
        by: "user" as const,
        optionId: "once",
      },
      {
        seq: 4,
        at: "2026-10-13T16:00:03.000Z",
        kind: "turn_end" as const,
        turnId: "private-turn",
        stopReason: "end_turn",
      },
    ];
    const adapter = createThreadReceiptAdapter(f.exporter, () => [
      { id, title: "local title", events },
    ]);
    for (const event of events) adapter.accept(id, "local title", event);
    await expect
      .poll(async () => (await f.journal.read({ kinds: ["turn", "permission"] })).length)
      .toBe(4);
    const rows = await f.journal.read({ kinds: ["turn", "permission"] });
    expect(rows[1]!.join.requestId).toBe(rows[2]!.join.requestId);
    expect(adapter.context.asked(rows[1]!)).toMatchObject({
      body: "local approval text",
      act: { kind: "permission", requestId: "private-request" },
    });
    expect(JSON.stringify(f.sent)).not.toContain("private");
    expect((f.sent.at(-1) as { properties: object }).properties).toMatchObject({
      phase: "finished",
      outcome: "incomplete",
      component: "pea",
    });
    const requestId = randomUUID();
    recordUpdateFact(f.exporter, {
      kind: "settled",
      requestId,
      state: "failed",
      version: null,
      detail: "private stderr",
      automatic: true,
      failedLeg: "msi",
      exitCode: 1603,
    });
    await expect.poll(async () => (await f.journal.read({ kinds: ["usage"] })).length).toBe(1);
    recordUpdateFact(f.exporter, {
      kind: "settled",
      requestId,
      state: "failed",
      version: null,
      detail: "private stderr",
      automatic: true,
      failedLeg: "msi",
      exitCode: 1603,
    });
    await f.exporter.close();
    expect(await f.journal.read({ kinds: ["usage"] })).toHaveLength(1);
    expect(f.sent.at(-1)).toMatchObject({
      event: "update_outcome",
      properties: { mode: "automatic", failed_leg: "msi", exit_code: 1603 },
    });
  } finally {
    await f.close();
  }
});

test("a turn's end exports its duration, tool count and closed failure class from the thread", async () => {
  const f = fixture();
  try {
    const id = "private-thread";
    const turnId = "private-turn";
    const at = (s: number) => `2026-10-13T16:00:0${s}.000Z`;
    const tool = (seq: number) => ({
      seq,
      at: at(seq),
      kind: "update",
      turnId,
      update: { sessionUpdate: "tool_call", toolCallId: `private-${seq}`, title: "private tool" },
    });
    const events = z.array(harnessEventSchema).parse([
      { seq: 1, at: at(1), kind: "prompt", turnId, text: "private prompt" },
      tool(2),
      tool(3),
      {
        seq: 5,
        at: at(5),
        kind: "error",
        turnId,
        message: "private words",
        failure: { kind: "billing", message: "private", raw: "private raw" },
      },
    ]);
    const adapter = createThreadReceiptAdapter(f.exporter, () => [
      { id, title: "private title", events },
    ]);
    for (const event of events) adapter.accept(id, "private title", event);
    await expect.poll(() => f.sent.length).toBe(2);
    expect(JSON.stringify(f.sent)).not.toContain("private");
    expect((f.sent.at(-1) as { properties: object }).properties).toMatchObject({
      phase: "failed",
      outcome: "failed",
      fault_code: "turn.billing",
      duration_ms: 4000,
      tool_count: 2,
    });
  } finally {
    await f.close();
  }
});

test("an open question and Pea's final words reach the notice context, never the export", async () => {
  const f = fixture();
  try {
    const id = "private-thread";
    const turn = "private-turn";
    const at = "2026-10-13T16:00:00.000Z";
    const chunk = (seq: number, text: string) => ({
      seq,
      at,
      kind: "update" as const,
      turnId: turn,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    });
    const events = [
      { seq: 1, at, kind: "prompt" as const, turnId: turn, text: "private prompt" },
      chunk(2, "private "),
      chunk(3, "answer"),
      {
        seq: 4,
        at,
        kind: "question_request" as const,
        turnId: turn,
        requestId: "private-question",
        message: "private which level?",
        requestedSchema: { type: "object" },
      },
      {
        seq: 5,
        at,
        kind: "question_resolved" as const,
        turnId: turn,
        requestId: "private-question",
        by: "user" as const,
        action: "decline" as const,
      },
      { seq: 6, at, kind: "turn_end" as const, turnId: turn, stopReason: "end_turn" },
    ] as HarnessEvent[];
    const adapter = createThreadReceiptAdapter(f.exporter, () => [
      { id, title: "local title", events },
    ]);
    for (const event of events) adapter.accept(id, "local title", event);
    await expect
      .poll(async () => (await f.journal.read({ kinds: ["turn", "question"] })).length)
      .toBe(4);
    const rows = await f.journal.read({ kinds: ["turn", "question"] });
    const asked = rows.find((r) => r.body.kind === "question" && r.body.phase === "asked")!;
    expect(adapter.context.asked(asked)).toMatchObject({
      threadId: id,
      body: "private which level?",
      act: { kind: "question", threadId: id, requestId: "private-question" },
    });
    const ended = rows.find((r) => r.body.kind === "turn" && r.body.phase === "finished")!;
    expect(adapter.context.said(ended)).toBe("private answer");
    await f.exporter.close();
    expect(JSON.stringify(f.sent)).not.toContain("private");
  } finally {
    await f.close();
  }
});

const settleAfter = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wireClient = (
  fetch: (url: string, init: { body?: unknown; signal?: AbortSignal }) => Promise<Response>,
) =>
  new PostHog("explicit-test-key", {
    disableCompression: true,
    disableGeoip: true,
    flushInterval: 0,
    fetchRetryCount: 0,
    enableExceptionAutocapture: false,
    fetch: abortableFetch(fetch as never),
  });

test("a stalled send keeps its capacity: the pending limit bounds the sends the client ever starts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-queue-bound-"));
  let subscriber: ((r: Receipt) => void) | undefined;
  let release: () => void = () => {};
  let started = 0;
  const journal = {
    subscribe: (_: unknown, f: (r: Receipt) => void) => {
      subscriber = f;
      return () => {};
    },
    recordFact: async () => {},
  };
  const client = {
    on: () => () => {},
    captureImmediate: () => {
      started++;
      return started === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    },
    shutdown: async () => {},
  };
  const exporter = createReceiptExport({
    journal: journal as never,
    root: dir,
    stamps: { host: { ...stamp, component: "host" }, web: null },
    client: client as never,
  });
  const emit = () => subscriber!({ ...receiptGoldenEnvelope, id: randomUUID() });
  try {
    for (let i = 0; i < 64; i++) emit();
    await settleAfter(2150);
    for (let i = 0; i < 64; i++) emit();
    release();
    await settleAfter(100);
    expect(started).toBe(64);
  } finally {
    await exporter.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("a send past its deadline is aborted on the wire, one at a time, and frees capacity only when it settles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-send-abort-"));
  let inFlight = 0;
  let peak = 0;
  let aborted = 0;
  const client = wireClient(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        peak = Math.max(peak, ++inFlight);
        init.signal!.addEventListener("abort", () => {
          inFlight--;
          aborted++;
          reject(Error("aborted"));
        });
      }),
  );
  const journal = new ActionJournal(join(dir, "journal.json"));
  const exporter = createReceiptExport({
    journal,
    root: dir,
    client,
    deadlineMs: 30,
    stamps: { host: { ...stamp, component: "host" }, web: null },
  });
  try {
    for (let i = 0; i < 3; i++)
      await exporter.record(
        { kind: "diagnostic", code: "pane.failed" },
        receiptGoldenEnvelope.join,
      );
    await expect.poll(() => aborted, { timeout: 3000 }).toBe(3);
    expect(peak).toBe(1);
  } finally {
    await exporter.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("feedback never reports failed, or offers a second send, while its first send is still in flight", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-feedback-flight-"));
  const journal = new ActionJournal(join(dir, "journal.json"), () => stamp);
  const requests: unknown[] = [];
  let release: (status: number) => void = () => {};
  const client = new PostHog("explicit-test-key", {
    disableCompression: true,
    disableGeoip: true,
    flushInterval: 0,
    fetchRetryCount: 0,
    enableExceptionAutocapture: false,
    requestTimeout: 60_000,
    fetch: (_url, init) => {
      requests.push(init.body);
      return new Promise(
        (resolve) => (release = (status) => resolve(new Response("{}", { status }))),
      );
    },
  });
  const web = { ...stamp, component: "web" as const };
  const exporter = createReceiptExport({
    journal,
    root: dir,
    client,
    deadlineMs: 100,
    stamps: { host: { ...stamp, component: "host" }, web },
  });
  const feedback = {
    comment: "note",
    url: "https://x/",
    selector: null,
    component: null,
    components: [],
    html: "",
    rect: { x: 0, y: 0, width: 1, height: 1 },
    viewport: { width: 1, height: 1, dpr: 1 },
    picture: null,
    picture_error: null,
  };
  try {
    const first = await exporter.submitFeedback(feedback, web.build);
    expect(first.delivery).toBe("uncertain");
    const again = await exporter.deliverFeedback(first.feedbackId);
    expect(again?.delivery).toBe("uncertain");
    expect(requests).toHaveLength(1);
    release(200);
    await settleAfter(50);
    expect(await exporter.deliverFeedback(first.feedbackId)).toEqual({
      feedbackId: first.feedbackId,
      delivery: "accepted",
    });
    expect(requests).toHaveLength(1);
  } finally {
    await exporter.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("an answered refusal is failed, not uncertain: the note was not taken", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-feedback-refused-"));
  const web = { ...stamp, component: "web" as const };
  const exporter = createReceiptExport({
    journal: new ActionJournal(join(dir, "journal.json"), () => stamp),
    root: dir,
    client: wireClient(async () => new Response("{}", { status: 503 })),
    stamps: { host: { ...stamp, component: "host" }, web },
  });
  try {
    const note = {
      comment: "note",
      url: "https://x/",
      selector: null,
      component: null,
      components: [],
      html: "",
      rect: { x: 0, y: 0, width: 1, height: 1 },
      viewport: { width: 1, height: 1, dpr: 1 },
      picture: null,
      picture_error: null,
    };
    const first = await exporter.submitFeedback(note, web.build);
    expect(first.delivery).toBe("failed");
    expect((await exporter.deliverFeedback(first.feedbackId))?.delivery).toBe("failed");
  } finally {
    await exporter.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a hanging fatal flush leaves local raw evidence and exits nonzero by the hard deadline", async () => {
  const f = fixture();
  const prior = process.env.LOCALAPPDATA;
  const priorHome = process.env.PE_TOOLS_PRODUCT_HOME;
  process.env.LOCALAPPDATA = f.dir;
  process.env.PE_TOOLS_PRODUCT_HOME = ""; // the LOCALAPPDATA-rooted lane
  try {
    const exit: number[] = [];
    const stalled = { ...f.exporter, close: () => new Promise<void>(() => {}) };
    const start = Date.now();
    await fatalReceipt(
      stalled,
      "process.uncaught",
      Error("local-only sentinel"),
      (c) => {
        exit.push(c);
      },
      35,
    );
    expect(Date.now() - start).toBeLessThan(500);
    expect(exit).toEqual([1]);
    expect(
      readFileSync(join(f.dir, "Positive Energy", "Pe.Tools", "logs", "host-fatal.jsonl"), "utf8"),
    ).toContain("local-only sentinel");
    expect(JSON.stringify(f.sent)).not.toContain("local-only sentinel");
  } finally {
    if (prior === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prior;
    if (priorHome === undefined) delete process.env.PE_TOOLS_PRODUCT_HOME;
    else process.env.PE_TOOLS_PRODUCT_HOME = priorHome;
    await f.close();
  }
});

test("the real fatal process exits 1 with a never-settling sink after committing raw local evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-fatal-child-"));
  const script = join(dir, "fatal.mts");
  const source = pathToFileURL(join(import.meta.dirname, "../src/receipt-export.ts")).href;
  writeFileSync(
    script,
    `import { fatalReceipt } from ${JSON.stringify(source)};\nconsole.log('fatal-ready');\nawait fatalReceipt({record: async () => {}, close: () => new Promise(() => {})} as never, 'process.uncaught', Error('raw-child-sentinel'), undefined, 35);\n`,
  );
  const child = spawn(process.execPath, ["--import", "jiti/register", script], {
    cwd: join(import.meta.dirname, ".."),
    windowsHide: true,
    env: {
      ...process.env,
      PE_LANE: "dev",
      LOCALAPPDATA: dir,
      PE_TOOLS_PRODUCT_HOME: join(dir, "Pe.Tools"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = 0;
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    if (String(chunk).includes("fatal-ready")) ready = Date.now();
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    expect(code, stderr).toBe(1);
    expect(ready).toBeGreaterThan(0);
    expect(Date.now() - ready).toBeLessThan(500);
    expect(
      readFileSync(join(dir, "Pe.Tools", ".local-state", "logs", "host-fatal.jsonl"), "utf8"),
    ).toContain("raw-child-sentinel");
  } finally {
    if (child.exitCode === null) child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
