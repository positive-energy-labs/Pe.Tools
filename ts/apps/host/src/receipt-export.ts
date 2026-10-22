import { peRoutes } from "@pe/agent-contracts/pe-api";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PostHog } from "posthog-node";
import { z } from "zod";
import {
  receiptSchema,
  receiptStampSchema,
  receiptReasonCodeSchema,
  readingRequestSchema,
  type Receipt,
  type ReceiptFact,
  type ReceiptStamp,
  type ReceiptJoin,
  type HarnessEvent,
} from "@pe/agent-contracts";
import {
  analyticsConfig,
  readOrCreateInstallId,
  writeFatalEvidence,
} from "@pe/runtime";
import { isAnyOperationKey, isTsOnlyOperationKey } from "@pe/host-contracts/operation-types";
import { ActionJournal } from "./action-journal.ts";
import { hostActionJournal, setHostReceiptStamp } from "./gateway-owner.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
import { subscribeReceiptProducers, type NativeReceiptProducer } from "./bridge.ts";
import type { NoticeContext } from "./notices.ts";
import type { UpdateFact } from "./update-reader.ts";

const mcpFields = [
  "$session_id",
  "$mcp_source",
  "$mcp_tool_name",
  "$mcp_duration_ms",
  "$mcp_is_error",
  "$mcp_input_keys",
  "$mcp_client_name",
  "$mcp_client_version",
  "$mcp_protocol_version",
  "$mcp_server_name",
  "$mcp_server_version",
  "$mcp_server_build",
] as const;
const eventFields = {
  app_boot: ["revit_version", "foreign_addin_count", "foreign_addin_years"],
  version_mismatch: ["host_version"],
  host_op: ["op", "origin_class", "ts_only", "outcome", "fault_code", "duration_ms", "status"],
  bridge_queue: ["op", "phase", "queue_depth", "wait_ms"],
  ribbon_click: ["command_code"],
  palette_action: ["palette", "tab", "item_kind", "mode", "outcome"],
  pea_turn: ["phase", "outcome", "fault_code", "duration_ms", "tool_count"],
  reading_timeout: ["reading_kind", "elapsed_ms"],
  reading_failure: ["reading_kind", "fault_code"],
  stream_fault: ["stream_kind", "fault_code", "elapsed_ms"],
  host_fault: ["route_code", "fault_code", "status"],
  telemetry_dropped: ["producer", "count"],
  refusal_count: ["reason_code", "count"],
  update_outcome: [
    "phase",
    "outcome",
    "fault_code",
    "duration_ms",
    "candidate_version",
    "mode",
    "failed_leg",
    "exit_code",
  ],
  $exception: ["fault_code", "$exception_fingerprint", "$exception_list", ...mcpFields],
  $mcp_tool_call: mcpFields,
  $mcp_initialize: mcpFields,
  ui_feedback: [
    "feedback_id",
    "comment",
    "url",
    "selector",
    "ui_component",
    "components",
    "html",
    "rect",
    "viewport",
    "picture",
    "picture_error",
  ],
  // Owner ruling 2026-10-14: Pea's own report on its tooling leaves the machine automatically while
  // users are coworkers. It rides beside the ui_feedback exception in ADR 0018; counsel amends the ADR.
  agent_feedback: [
    "feedback_id",
    "surface",
    "expected",
    "observed",
    "workaround",
    "refs",
    "caller_kind",
    "thread_id",
    "turn_id",
    "harness_provider",
    "harness_model",
  ],
} as const;
type ExportEvent = {
  event: keyof typeof eventFields;
  distinctId: string;
  timestamp: Date;
  properties: Record<string, unknown>;
  /** A fixed event id, so a replayed send is the same PostHog event. */
  uuid?: string;
};
// Compiled Pe.App command types, never ribbon labels or authored task/Pod ids.
export const commandCodes = new Set([
  "StartupCommand",
  "CmdAutoTag",
  "CmdApsAuth",
  "CmdMep2040",
  "CmdCloseModel",
  "CmdCacheParametersService",
  "CmdTapMaker",
  "CmdScheduleManagerSerialize",
  "CmdScheduleManager",
  "CmdPeTools",
  "CmdPeToolsHome",
  "CmdPea",
  "CmdFamilyEditor",
  "CmdFamilyAudit",
  "CmdSchedulesWeb",
  "CmdTakeoffsWeb",
  "CmdPodsWeb",
  "CmdPltMruViews",
  "CmdFFMigrator",
  "CmdFFManager",
  "CmdPltFamilyElements",
  "CmdPltFamilyElementsFamilies",
  "CmdPltFamilyElementsParams",
  "CmdPltFamilyElementsDims",
  "CmdPltFamilyElementsRefPlanes",
  "CmdPltFamilyElementsConnectors",
  "CmdPltFamilyInstances",
  "CmdPltTasks",
  "CmdPltCommands",
  "CmdPltFamilies",
  "CmdPltFamilyTypes",
  "CmdPltViews",
  "CmdPltViewsOnly",
  "CmdPltSchedules",
  "CmdPltSheets",
]);
const readings = new Set(
  readingRequestSchema.options.flatMap((s) => {
    const shape = "shape" in s ? s.shape : null;
    return shape && "kind" in shape ? [shape.kind.value as string] : ["work"];
  }),
);
const streams = new Set(["readings", "machine", "bridge", "notices"]);
const routes = new Set([
  "call",
  "actions",
  "feedback",
  "diagnostics",
  "mcp",
  "resources",
  "update",
  "host",
]);
const reasons = new Set<string>(receiptReasonCodeSchema.options);
/** A failed action's closed code: the refusal it carries (`Refused` says `code: reason`), else generic. */
const actionFault = (error: string) => {
  const code = /^(?:\w*Error: )?([a-z][a-z.-]*):/.exec(error)?.[1];
  return code && reasons.has(code) ? code : "action.failed";
};
/** Whole milliseconds between two ISO stamps; absent when either is unreadable. */
const elapsed = (from: string, to: string) => {
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
};
const validVersion = (v: string) => /^(dev|\d{4}|\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?)$/.test(v);
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const exception = (code: string, component: string, handled: boolean) => ({
  fault_code: code,
  $exception_fingerprint: [component, code],
  $exception_list: [{ type: code, value: code, mechanism: { handled, synthetic: true } }],
});

/** Construct, rather than redact, the only remote event shape. Unknown identity stays local. */
export function projectReceipt(
  receipt: Receipt,
  feedback?: Record<string, unknown>,
): ExportEvent | null {
  const parsed = receiptSchema.safeParse(receipt);
  if (!parsed.success || !parsed.data.stamp) return null;
  const r = parsed.data;
  const stamp = r.stamp!;
  let event: keyof typeof eventFields;
  let properties: Record<string, unknown> = {};
  const body = r.body;
  switch (body.kind) {
    case "action": {
      if (!isAnyOperationKey(body.value.key) || body.value.state === "running") return null;
      event = "host_op";
      const caller = body.value.caller.kind;
      const settled = body.value;
      properties = {
        op: settled.key,
        outcome: settled.state,
        duration_ms: elapsed(settled.startedAt, r.at),
        ...(settled.state === "succeeded" ? {} : { status: settled.status }),
        ...(settled.state === "succeeded" || settled.state === "cancelled"
          ? {}
          : { fault_code: actionFault(settled.error) }),
        ts_only: isTsOnlyOperationKey(body.value.key),
        origin_class:
          caller === "pea" || caller === "human" || caller === "page"
            ? caller
            : caller === "external-mcp"
              ? "external"
              : "system",
      };
      break;
    }
    case "queue":
      if (!isAnyOperationKey(body.op)) return null;
      event = "bridge_queue";
      properties = {
        op: body.op,
        phase: body.phase,
        queue_depth: body.depth,
        wait_ms: body.waitMs,
      };
      break;
    case "turn":
      event = "pea_turn";
      properties = {
        phase: body.phase,
        outcome:
          body.phase === "finished" ? "incomplete" : body.phase === "failed" ? "failed" : undefined,
        fault_code: body.code,
        duration_ms: body.durationMs,
        tool_count: body.toolCount,
      };
      break;
    case "diagnostic": {
      if (
        (body.readingKind && !readings.has(body.readingKind)) ||
        (body.streamKind && !streams.has(body.streamKind)) ||
        (body.routeCode && !routes.has(body.routeCode))
      )
        return null;
      event =
        body.code === "reading.timeout"
          ? "reading_timeout"
          : body.code === "reading.failed"
            ? "reading_failure"
            : body.code === "stream.failed"
              ? "stream_fault"
              : [
                    "pane.failed",
                    "parts.failed",
                    "native.failed",
                    "process.uncaught",
                    "process.unhandled-rejection",
                  ].includes(body.code)
                ? "$exception"
                : "host_fault";
      properties =
        event === "$exception"
          ? exception(body.code, stamp.component, !body.code.startsWith("process."))
          : {
              fault_code: body.code,
              reading_kind: body.readingKind,
              stream_kind: body.streamKind,
              route_code: body.routeCode,
              elapsed_ms: body.elapsedMs,
            };
      break;
    }
    case "usage": {
      event = body.event;
      const c = body.counters;
      if (
        (c.op && !isAnyOperationKey(c.op)) ||
        (c.commandCode && !commandCodes.has(c.commandCode)) ||
        (c.readingKind && !readings.has(c.readingKind)) ||
        (c.streamKind && !streams.has(c.streamKind)) ||
        (c.routeCode && !routes.has(c.routeCode)) ||
        (c.reasonCode && !reasons.has(c.reasonCode))
      )
        return null;
      if (
        (c.revitVersion && !validVersion(c.revitVersion)) ||
        (c.hostVersion && !validVersion(c.hostVersion)) ||
        (c.candidateVersion && !validVersion(c.candidateVersion))
      )
        return null;
      if (
        event === "palette_action" &&
        (c.palette !== "do" ||
          !["commands", "tasks", "scripts"].includes(c.tab ?? "") ||
          !["command", "task", "script"].includes(c.itemKind ?? "") ||
          (c.mode && !["read-only", "write"].includes(c.mode)))
      )
        return null;
      if (event === "update_outcome" && c.mode && !["automatic", "manual"].includes(c.mode))
        return null;
      properties =
        event === "$exception"
          ? exception(c.faultCode ?? "host.failed", stamp.component, true)
          : Object.fromEntries(Object.entries(c).map(([k, v]) => [snake(k), v]));
      break;
    }
    case "mcp": {
      event = body.event;
      const m = body.metadata;
      properties = {
        $session_id: m.sessionId,
        $mcp_source: m.source,
        $mcp_tool_name: m.toolName,
        $mcp_duration_ms: m.durationMs,
        $mcp_is_error: m.isError,
        $mcp_input_keys: m.inputKeys,
        $mcp_client_name: m.clientName,
        $mcp_client_version: m.clientVersion,
        $mcp_protocol_version: m.protocolVersion,
        $mcp_server_name: m.serverName,
        $mcp_server_version: m.serverVersion,
        $mcp_server_build: m.serverBuild,
        ...(event === "$exception" ? exception("mcp.failed", stamp.component, true) : {}),
      };
      break;
    }
    case "feedback":
      if (!body.explicitHumanSubmit || !feedback || stamp.component !== "web") return null;
      event = "ui_feedback";
      properties = { ...feedback, feedback_id: body.localRef.feedbackId };
      break;
    default:
      return null;
  }
  return stamped(event, properties, new Date(r.at), stamp, r.join);
}

/** The one remote event shape: allowlisted fields, then the host's stamps. */
function stamped(
  event: keyof typeof eventFields,
  properties: Record<string, unknown>,
  timestamp: Date,
  stamp: ReceiptStamp,
  join?: ReceiptJoin,
): ExportEvent {
  const picked = Object.fromEntries(
    eventFields[event]
      .filter((key) => properties[key] !== undefined)
      .map((key) => [key, properties[key]]),
  );
  return {
    event,
    distinctId: stamp.installId,
    timestamp,
    properties: {
      ...picked,
      install_id: stamp.installId,
      process_session_id: stamp.processSessionId,
      ...Object.fromEntries(Object.entries(join ?? {}).map(([k, v]) => [snake(k), v])),
      component: stamp.component,
      version: stamp.version,
      build: stamp.build,
      commit: stamp.commit,
      lane: stamp.lane,
      $geoip_disable: true,
      $process_person_profile: false,
    },
  };
}

/** The running turn and harness behind a thread, as the host knows them when a report arrives. */
export type AgentReportContext = { turnId: string | null; provider: string; model: string | null };

const feedbackSchema = peRoutes["feedback.submit"].body;
const diagnosticsSchema = peRoutes["diagnostics.submit"].body;
const agentFeedbackSchema = peRoutes["agent-feedback.submit"].body;
/** One kept agent-feedback JSONL row: the report plus the host's stamps and local joins. */
const agentFeedbackRowSchema = agentFeedbackSchema.extend({
  feedbackId: z.uuid(),
  at: z.iso.datetime(),
  commit: z.string().nullable(),
  version: z.string().nullable(),
  installId: z.string().nullable(),
  callerKind: z.string(),
  threadId: z.string().nullable(),
  turnId: z.string().nullable(),
  harnessProvider: z.string().nullable(),
  harnessModel: z.string().nullable(),
});
type AgentFeedbackRow = z.infer<typeof agentFeedbackRowSchema>;
type ProducerStamps = { host: ReceiptStamp | null; web: ReceiptStamp | null };

const DEADLINE_MS = 2000;
async function bounded<T>(work: Promise<T>, ms = DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("Telemetry deadline exceeded")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** The send on the wire now: its deadline signal, read by the PostHog client's fetch below. */
const wire = new AsyncLocalStorage<AbortSignal>();
type PostHogFetch = NonNullable<NonNullable<ConstructorParameters<typeof PostHog>[1]>["fetch"]>;
/** The fetch for a PostHog client that exports receipts: a send's deadline aborts its HTTP request. */
export const abortableFetch =
  (base: PostHogFetch = fetch as never): PostHogFetch =>
  (url, init) => {
    const send = wire.getStore();
    return base(
      url,
      send ? { ...init, signal: AbortSignal.any([send, init.signal ?? send]) } : init,
    );
  };

type FeedbackDelivery =
  | { feedbackId: string; delivery: "accepted" }
  | { feedbackId: string; delivery: "failed" | "uncertain"; error: string };

export function createReceiptExport(options: {
  journal: ActionJournal;
  root: string;
  stamps: ProducerStamps;
  client?: PostHog;
  send?: (event: ExportEvent, signal: AbortSignal) => Promise<void>;
  /** How long one send may hold the wire before its signal aborts it. */
  deadlineMs?: number;
}) {
  const { journal, stamps } = options;
  const deadlineMs = options.deadlineMs ?? DEADLINE_MS;
  const webStamp = (build: string | null | undefined) =>
    stamps.web && build === stamps.web.build ? stamps.web : null;
  // A send holds its capacity until it settles. Its deadline aborts it; it is never abandoned running.
  const withDeadline = async (
    event: ExportEvent,
    run: (event: ExportEvent, signal: AbortSignal) => Promise<void>,
  ) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(Error("Telemetry deadline exceeded")), deadlineMs);
    try {
      await run(event, abort.signal);
    } finally {
      clearTimeout(timer);
    }
  };
  // posthog-node resolves captureImmediate even when HTTP failed. Serialize this one client's
  // sends so its error channel belongs to the exact receipt being delivered. A send's deadline
  // starts when it reaches the wire, not when it queues.
  let delivery = Promise.resolve();
  const sendClient = (event: ExportEvent, signal: AbortSignal) =>
    wire.run(signal, async () => {
      const client = options.client!;
      let failure: unknown;
      const release = client.on("error", (error: unknown) => {
        failure = error;
      });
      try {
        await client.captureImmediate(event);
        if (failure) throw failure;
      } finally {
        release();
      }
    });
  const send = options.send
    ? (event: ExportEvent) => withDeadline(event, options.send!)
    : options.client
      ? (event: ExportEvent) => {
          const next = delivery.then(() => withDeadline(event, sendClient));
          delivery = next.catch(() => {});
          return next;
        }
      : undefined;
  const pending = new Set<Promise<unknown>>();
  let remotePending = 0;
  let dropped = 0;
  const seen = new Map<string, number>();
  const local = (error: unknown) => console.warn("Receipt telemetry unavailable", error);
  const track = (work: Promise<unknown>) => {
    pending.add(work);
    void work.catch(local).finally(() => pending.delete(work));
  };
  const unsubscribe = journal.subscribe({}, (r) => {
    // Feedback is delivered only by its explicit submit/retry door, never twice by the subscriber.
    if (r.body.kind === "feedback" || (seen.get(r.id) ?? 0) >= r.revision) return;
    seen.set(r.id, r.revision);
    if (seen.size > 1024) seen.delete(seen.keys().next().value!);
    const event = projectReceipt(r);
    if (event) enqueue(event);
  });
  /** The one bounded export queue: at 64 pending, an event is dropped and counted, never awaited. */
  function enqueue(event: ExportEvent, delivered?: () => void) {
    if (!send) return;
    if (remotePending === 64) {
      dropped++;
      return;
    }
    remotePending++;
    track(
      send(event)
        .then(delivered)
        .finally(() => {
          remotePending--;
          if (dropped) {
            const count = dropped;
            dropped = 0;
            track(
              journal.recordFact(
                {
                  kind: "usage",
                  event: "telemetry_dropped",
                  counters: { producer: "host", count },
                },
                undefined,
                stamps.host,
              ),
            );
          }
        }),
    );
  }
  const deliver = async (id: string): Promise<FeedbackDelivery | null> => {
    const r = (await journal.read({ kinds: ["feedback"] })).find(
      (r) => r.body.kind === "feedback" && r.body.localRef.feedbackId === id,
    );
    if (!r || r.body.kind !== "feedback") return null;
    let event: ExportEvent | null;
    try {
      const saved = JSON.parse(readFileSync(r.body.localRef.path, "utf8")) as { feedback: unknown };
      const { component: ui_component, ...content } = feedbackSchema.parse(saved.feedback);
      event = projectReceipt(r, { ...content, ui_component });
      if (!event || !send)
        throw Error("Telemetry export is not configured with verified web identity");
    } catch {
      return {
        feedbackId: id,
        delivery: "failed",
        error: "The host kept the feedback. Delivery failed; try deliver again.",
      };
    }
    try {
      await send(event);
      return { feedbackId: id, delivery: "accepted" };
    } catch (error) {
      // Only an answered refusal proves the note was not taken; a deadline or a dropped connection may follow acceptance.
      return error instanceof Error && error.name === "PostHogFetchHttpError"
        ? {
            feedbackId: id,
            delivery: "failed",
            error: "The host kept the feedback. PostHog refused it; try deliver again.",
          }
        : {
            feedbackId: id,
            delivery: "uncertain",
            error:
              "The host kept the feedback. PostHog may or may not have received it; delivering again repeats the same note.",
          };
    }
  };
  // One flight per kept note: a second ask joins it, and an accepted note is never sent again.
  const flights = new Map<string, Promise<FeedbackDelivery | null>>();
  const record = (
    body: ReceiptFact,
    join?: ReceiptJoin,
    stamp: ReceiptStamp | null = stamps.host,
    source?: { id: string; at: string },
  ) => journal.recordFact(body, join, stamp, source);
  // Agent feedback is kept in its JSONL first; a delivered id is appended beside it only after
  // PostHog took the event. Every undelivered row is replayed at the next start under its
  // feedbackId as the event uuid, so a resend is the same event.
  const agentFeedbackLog = join(options.root, "agent-feedback.jsonl");
  const deliveredLog = join(options.root, "agent-feedback.delivered");
  const exportAgentFeedback = (row: AgentFeedbackRow) => {
    const host = stamps.host;
    if (!host || !send) return;
    track(
      (async () => {
        // Local ids stay local; the export joins the receipt spine by the same opaque ids.
        const thread = row.threadId;
        const threadId = thread ? await journal.opaqueId("thread", thread) : undefined;
        const turnId =
          thread && row.turnId
            ? await journal.opaqueId("turn", `${thread}:${row.turnId}`)
            : undefined;
        const event = stamped(
          "agent_feedback",
          {
            ...row,
            feedback_id: row.feedbackId,
            caller_kind: row.callerKind,
            thread_id: threadId,
            turn_id: turnId,
            harness_provider: row.harnessProvider ?? undefined,
            harness_model: row.harnessModel ?? undefined,
          },
          new Date(row.at),
          host,
        );
        enqueue({ ...event, uuid: row.feedbackId }, () =>
          appendFileSync(deliveredLog, `${row.feedbackId}\n`),
        );
      })(),
    );
  };
  if (stamps.host && send && existsSync(agentFeedbackLog)) {
    const delivered = new Set(
      existsSync(deliveredLog) ? readFileSync(deliveredLog, "utf8").split("\n") : [],
    );
    for (const line of readFileSync(agentFeedbackLog, "utf8").split("\n")) {
      // A torn or foreign line stays in the file for inspection and is not replayed.
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      const row = agentFeedbackRowSchema.safeParse(value);
      if (row.success && !delivered.has(row.data.feedbackId)) exportAgentFeedback(row.data);
    }
  }
  return {
    journal,
    stamps,
    client: options.client,
    track,
    record,
    async submitFeedback(feedback: z.infer<typeof feedbackSchema>, browserBuild?: string | null) {
      const id = randomUUID();
      const path = join(options.root, "feedback", `${id}.json`);
      mkdirSync(join(options.root, "feedback"), { recursive: true });
      writeFileSync(path, JSON.stringify({ feedback }), { flag: "wx" });
      await record(
        { kind: "feedback", explicitHumanSubmit: true, localRef: { feedbackId: id, path } },
        undefined,
        webStamp(browserBuild),
      );
      return (await this.deliverFeedback(id))!;
    },
    /**
     * Pea's report on its own tooling: kept locally first, then exported best-effort on the
     * existing queue. The host supplies every stamp; the report never blocks on the export.
     */
    async submitAgentFeedback(
      report: z.infer<typeof agentFeedbackSchema>,
      callerKind: string,
      thread: string | null,
      context: AgentReportContext | null,
    ) {
      const feedbackId = randomUUID();
      const at = new Date();
      const host = stamps.host;
      const row: AgentFeedbackRow = {
        ...report,
        feedbackId,
        at: at.toISOString(),
        commit: host?.commit ?? null,
        version: host?.version ?? null,
        installId: host?.installId ?? null,
        callerKind,
        threadId: thread,
        turnId: context?.turnId ?? null,
        harnessProvider: context?.provider ?? null,
        harnessModel: context?.model ?? null,
      };
      mkdirSync(options.root, { recursive: true });
      appendFileSync(agentFeedbackLog, `${JSON.stringify(row)}\n`);
      exportAgentFeedback(row);
      return { feedbackId };
    },
    async deliverFeedback(id: string): Promise<FeedbackDelivery | null> {
      let flight = flights.get(id);
      if (!flight) {
        flight = deliver(id);
        flights.set(id, flight);
        void flight.then((d) => d?.delivery === "accepted" || flights.delete(id));
      }
      // The door answers within two deadlines; a send still queued or on the wire is uncertain, not failed.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          flight,
          new Promise<FeedbackDelivery>((resolve) => {
            timer = setTimeout(
              () =>
                resolve({
                  feedbackId: id,
                  delivery: "uncertain",
                  error:
                    "The host kept the feedback and is still delivering it; ask again before sending it again.",
                }),
              deadlineMs * 2,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    async diagnostics(batch: z.infer<typeof diagnosticsSchema>, browserBuild?: string | null) {
      for (const fact of batch.facts)
        await record(
          fact.body as ReceiptFact,
          { requestId: randomUUID(), browserSessionId: batch.browserSessionId },
          webStamp(browserBuild),
          { id: randomUUID(), at: fact.at },
        );
      if (batch.dropped)
        await record(
          {
            kind: "usage",
            event: "telemetry_dropped",
            counters: { producer: "web", count: batch.dropped },
          },
          { requestId: randomUUID(), browserSessionId: batch.browserSessionId },
          webStamp(browserBuild),
        );
    },
    async close() {
      unsubscribe();
      await bounded(Promise.allSettled(pending)).catch(local);
      if (options.client) await bounded(options.client.shutdown()).catch(local);
    },
  };
}
export type ReceiptExport = ReturnType<typeof createReceiptExport>;

// H bakes these into the actual host module graph and served web artifact. Missing evidence is local-only.
declare const __PE_HOST_RECEIPT_BUILD__:
  | { version: string; build: string; commit: string }
  | undefined;
declare const __PE_WEB_RECEIPT_BUILD__:
  | { version: string; build: string; commit: string }
  | undefined;
export function admitBuild(
  component: "host" | "web",
  metadata: unknown,
  installId: string | null,
  processSessionId: string,
): ReceiptStamp | null {
  const identity = receiptStampSchema
    .unwrap()
    .pick({ version: true, build: true, commit: true })
    .safeParse(metadata);
  if (!identity.success) return null;
  const result = receiptStampSchema.safeParse({
    ...identity.data,
    component,
    installId,
    processSessionId,
    lane: hostOwnership.lane,
  });
  return result.success ? result.data : null;
}
let active: ReceiptExport | undefined;
export function hostReceiptExport() {
  if (active) return active;
  const install = readOrCreateInstallId();
  const processSessionId = randomUUID();
  const stamps = {
    host: admitBuild(
      "host",
      typeof __PE_HOST_RECEIPT_BUILD__ !== "undefined" ? __PE_HOST_RECEIPT_BUILD__ : null,
      install,
      processSessionId,
    ),
    web: admitBuild(
      "web",
      typeof __PE_WEB_RECEIPT_BUILD__ !== "undefined" ? __PE_WEB_RECEIPT_BUILD__ : null,
      install,
      processSessionId,
    ),
  };
  if (stamps.host) setHostReceiptStamp(stamps.host);
  const journal = hostActionJournal();
  const config = stamps.host ? analyticsConfig(hostOwnership.lane) : null;
  const client = config
    ? new PostHog(config.apiKey, {
        host: config.host,
        disableGeoip: true,
        flushAt: 1,
        fetchRetryCount: 0,
        enableExceptionAutocapture: false,
        fetch: abortableFetch(),
      })
    : undefined;
  active = createReceiptExport({
    journal,
    stamps,
    client,
    root: join(productRoot(), "state", "host", hostOwnership.serviceName),
  });
  if (!stamps.host)
    active.track(active.record({ kind: "diagnostic", code: "identity.unavailable" }));
  return active;
}
export function recordHostFact(body: ReceiptFact, join?: ReceiptJoin) {
  if (!active) {
    console.warn("Host receipt producer is not initialized");
    return;
  }
  active.track(active.record(body, join));
}

/** The connection admits the native incarnation and payload; raw process/session identity stays local. */
export async function acceptNativeProducer(
  exporter: ReceiptExport,
  producer: NativeReceiptProducer,
) {
  const { fact, connection: c } = producer;
  const join = await exporter.journal.requestJoin(fact.join.requestId);
  const processSessionId = await exporter.journal.opaqueId(
    "process",
    `${c.processId}:${c.processStartUtcUnixMs}`,
  );
  const candidate = receiptStampSchema.safeParse({
    ...fact.emitter,
    installId: exporter.stamps.host?.installId,
    processSessionId,
    component: "revit",
    lane: c.lane,
  });
  const stamp =
    candidate.success && c.processStartUtcUnixMs !== null && c.buildStamp === candidate.data.build
      ? candidate.data
      : null;
  await exporter.record(fact.body, join, stamp, { id: fact.id, at: fact.at });
}
export function bindNativeProducers(exporter: ReceiptExport) {
  return subscribeReceiptProducers((p) => exporter.track(acceptNativeProducer(exporter, p)));
}

type ThreadSnapshot = { id: string; title: string; events: readonly HarnessEvent[] };
export function createThreadReceiptAdapter(
  exporter: ReceiptExport,
  snapshot: () => readonly ThreadSnapshot[],
) {
  const localIds = new Map<string, string>();
  const localTurns = new Map<string, { threadId: string; turnId: string }>();
  let tail = Promise.resolve();
  const peaStamp = exporter.stamps.host
    ? receiptStampSchema.parse({ ...exporter.stamps.host, component: "pea" })
    : null;
  const threadJoin = async (id: string) => {
    const opaque = await exporter.journal.opaqueId("thread", id);
    localIds.set(opaque, id);
    return opaque;
  };
  const eventOf = (ref: { threadId: string; eventId: string }) =>
    snapshot()
      .find((t) => t.id === ref.threadId)
      ?.events.find((e) => String(e.seq) === ref.eventId);
  const context: NoticeContext = {
    thread(opaque) {
      const thread = snapshot().find((t) => t.id === localIds.get(opaque));
      return thread ? { id: thread.id, title: thread.title } : undefined;
    },
    asked(r) {
      if (r.body.kind !== "permission" && r.body.kind !== "question") return undefined;
      const threadId = r.body.localRef.threadId;
      const e = eventOf(r.body.localRef);
      if (e?.kind === "permission_request")
        return {
          threadId,
          body: e.toolCall.title ?? "A tool call is waiting.",
          act: { kind: "permission", threadId, requestId: e.requestId, options: e.options },
        };
      if (e?.kind === "question_request")
        return {
          threadId,
          body: e.message,
          act: {
            kind: "question",
            threadId,
            requestId: e.requestId,
            message: e.message,
            requestedSchema: e.requestedSchema,
          },
        };
      return undefined;
    },
    said(r) {
      const turn = r.join.turnId ? localTurns.get(r.join.turnId) : undefined;
      const text = snapshot()
        .find((t) => t.id === turn?.threadId)
        ?.events.flatMap((e) =>
          e.kind === "update" &&
          e.turnId === turn?.turnId &&
          e.update.sessionUpdate === "agent_message_chunk"
            ? [(e.update as { content?: { type?: string; text?: string } }).content]
            : [],
        )
        .map((content) => (content?.type === "text" ? (content.text ?? "") : ""))
        .join("")
        .trim();
      return text || undefined;
    },
  };
  const ASKS = {
    permission_request: ["permission", "asked"],
    permission_resolved: ["permission", "resolved"],
    question_request: ["question", "asked"],
    question_resolved: ["question", "resolved"],
  } as const;
  const accept = (id: string, _title: string, event: HarnessEvent) => {
    if (
      ![
        "prompt",
        "turn_end",
        "error",
        "permission_request",
        "permission_resolved",
        "question_request",
        "question_resolved",
      ].includes(event.kind)
    )
      return;
    const failure = event.kind === "error" ? event.failure?.kind : undefined;
    tail = tail
      .then(async () => {
        // A turn's end carries its span and tool count, read after the thread owner has initialized, never its words.
        const ended = event.kind === "turn_end" || event.kind === "error" ? event : undefined;
        const events = ended?.turnId
          ? (snapshot()
              .find((t) => t.id === id)
              ?.events.filter((e) => e.seq <= ended.seq) ?? [])
          : [];
        const prompt = events.find((e) => e.kind === "prompt" && e.turnId === ended?.turnId);
        const span =
          ended && prompt
            ? {
                durationMs: elapsed(prompt.at, ended.at),
                toolCount: events.filter(
                  (e) =>
                    e.kind === "update" &&
                    e.turnId === ended.turnId &&
                    e.update.sessionUpdate === "tool_call",
                ).length,
              }
            : {};
        const threadId = await threadJoin(id);
        const turnId =
          "turnId" in event && event.turnId
            ? await exporter.journal.opaqueId("turn", `${id}:${event.turnId}`)
            : undefined;
        if (turnId && "turnId" in event && event.turnId)
          localTurns.set(turnId, { threadId: id, turnId: event.turnId });
        const ask = event.kind in ASKS ? ASKS[event.kind as keyof typeof ASKS] : undefined;
        const requestId = await exporter.journal.opaqueId(
          "request",
          ask && "requestId" in event
            ? `${id}:${ask[0]}:${event.requestId}`
            : `${id}:turn:${"turnId" in event ? event.turnId : event.seq}`,
        );
        const body: ReceiptFact = ask
          ? { kind: ask[0], phase: ask[1], localRef: { threadId: id, eventId: String(event.seq) } }
          : {
              kind: "turn",
              phase:
                event.kind === "prompt"
                  ? "started"
                  : event.kind === "turn_end"
                    ? "finished"
                    : "failed",
              ...(event.kind === "error"
                ? {
                    code:
                      failure && failure !== "other" ? (`turn.${failure}` as const) : "turn.failed",
                  }
                : {}),
              ...span,
            };
        const sourceId = await exporter.journal.opaqueId("request", `${id}:event:${event.seq}`);
        await exporter.record(
          body,
          { requestId, threadId, ...(turnId ? { turnId } : {}) },
          peaStamp,
          { id: sourceId, at: event.at },
        );
      })
      .catch((error) => console.warn("Thread receipt persistence failed", error));
    exporter.track(tail);
  };
  return { accept, context, hydrate: () => Promise.all(snapshot().map((t) => threadJoin(t.id))) };
}

export function recordUpdateFact(exporter: ReceiptExport, fact: UpdateFact) {
  exporter.track(
    (async () => {
      const requestId =
        fact.kind === "settled"
          ? fact.requestId
          : await exporter.journal.opaqueId("request", `update-available:${fact.version}`);
      const body: ReceiptFact = {
        kind: "usage",
        event: "update_outcome",
        counters:
          fact.kind === "available"
            ? {
                phase: "available",
                candidateVersion: fact.version,
                mode: fact.automatic ? "automatic" : "manual",
              }
            : {
                phase: fact.state === "ok" ? "finished" : "failed",
                ...(fact.version ? { candidateVersion: fact.version } : {}),
                outcome: fact.state === "ok" ? "succeeded" : fact.state,
                ...(fact.state === "failed" ? { faultCode: "update.failed" as const } : {}),
                ...(fact.automatic === null
                  ? {}
                  : { mode: fact.automatic ? "automatic" : "manual" }),
                ...(fact.failedLeg ? { failedLeg: fact.failedLeg } : {}),
                ...(fact.exitCode === null ? {} : { exitCode: fact.exitCode }),
              },
      };
      // A successor rereads the same update id. The first committed emitter/time owns the fact.
      const existing = (await exporter.journal.read({ kinds: ["usage"], requestId })).find(
        (r) => r.body.kind === "usage" && r.body.event === "update_outcome",
      );
      if (!existing)
        await exporter.record(body, { requestId }, exporter.stamps.host, {
          id: requestId,
          at: new Date().toISOString(),
        });
    })(),
  );
}

/** Raw fatal evidence is local first. Remote work cannot hold the nonzero exit past the deadline. */
export async function fatalReceipt(
  exporter: ReceiptExport,
  code: "process.uncaught" | "process.unhandled-rejection",
  error: unknown,
  exit: (code: number) => void = (code) => process.exit(code),
  ms = 2000,
) {
  writeFatalEvidence(code, error);
  try {
    await bounded(
      (async () => {
        await exporter.record({ kind: "diagnostic", code });
        await exporter.close();
      })(),
      ms,
    );
  } catch {
    /* local record remains */
  } finally {
    exit(1);
  }
}
