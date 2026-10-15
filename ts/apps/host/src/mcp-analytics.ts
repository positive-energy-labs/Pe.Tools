import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { instrument, getToolInputProperties, type BeforeSendFn } from "@posthog/mcp";
import { peaProductTools } from "@pe/mcps";
import {
  safeMcpMetadataSchema,
  receiptJoinSchema,
  type ReceiptJoin,
  type ReceiptFact,
} from "@pe/agent-contracts";
import type { InvocationContext } from "@pe/runtime/context";
import type { ReceiptExport } from "./receipt-export.ts";

const token = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(value)
    ? value
    : undefined;
const clientNames = new Set([
  "claude-code",
  "claude-desktop",
  "codex",
  "cursor",
  "inspector",
  "mcp-inspector",
]);

/** SDK payloads never leave this hook. Only rebuilt, schema-valid facts enter the receipt owner. */
export function mcpBeforeSend(
  exporter: ReceiptExport,
  currentJoin: () => ReceiptJoin | undefined,
  sessionId = randomUUID(),
): BeforeSendFn {
  const queue: Array<{ body: ReceiptFact; join: ReceiptJoin; at: string }> = [];
  let draining = false;
  let dropped = 0;
  const drain = async () => {
    try {
      while (queue.length) {
        const fact = queue.shift()!;
        try {
          await exporter.record(fact.body, fact.join, exporter.stamps.host, {
            id: randomUUID(),
            at: fact.at,
          });
        } catch (error) {
          console.warn("MCP receipt persistence failed", error);
        }
      }
      if (dropped) {
        const count = dropped;
        dropped = 0;
        await exporter.record({
          kind: "usage",
          event: "telemetry_dropped",
          counters: { producer: "host", count },
        });
      }
    } finally {
      draining = false;
    }
  };
  return (event) => {
    if (!["$mcp_initialize", "$mcp_tool_call", "$exception"].includes(event.event)) return null;
    const p = event.properties;
    delete p.$mcp_parameters;
    delete p.$mcp_response;
    delete p.$mcp_intent;
    delete p.$mcp_error_message;
    delete p.$exception_stack_trace_raw;
    // The SDK adds prefixed session ids. Keep a separate opaque transport mapping, never export it.
    const stamp = exporter.stamps.host;
    const joined = receiptJoinSchema.safeParse(currentJoin());
    if (!stamp || !joined.success) return null;
    const name = token(p.$mcp_client_name)?.toLowerCase();
    const tool = Object.values(peaProductTools).find((t) => t.id === p.$mcp_tool_name);
    if (event.event !== "$mcp_initialize" && !tool) return null;
    const keys = Array.isArray(p.$mcp_input_keys)
      ? p.$mcp_input_keys.filter((v): v is string => token(v) !== undefined)
      : [];
    const declared = tool
      ? getToolInputProperties(Object.fromEntries(keys.map((key) => [key, null])), tool.inputSchema)
          .$mcp_input_keys
      : undefined;
    const metadata = safeMcpMetadataSchema.safeParse({
      source: "server",
      sessionId,
      toolName: tool?.id,
      durationMs: typeof p.$mcp_duration_ms === "number" ? p.$mcp_duration_ms : undefined,
      isError: typeof p.$mcp_is_error === "boolean" ? p.$mcp_is_error : undefined,
      inputKeys: Array.isArray(declared)
        ? declared.filter((v) => token(v) !== undefined && v !== "redacted").slice(0, 64)
        : undefined,
      clientName: name ? (clientNames.has(name) ? name : "other") : undefined,
      clientVersion:
        typeof p.$mcp_client_version === "string" &&
        /^\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9.-]+)?$/.test(p.$mcp_client_version)
          ? p.$mcp_client_version
          : undefined,
      protocolVersion: p.$mcp_protocol_version === "2025-11-25" ? "2025-11-25" : undefined,
      serverName: "pea",
      serverVersion: "0.0.0", // createPeaMcpServer's protocol version, separate from the host release.
      serverBuild: stamp.build,
      ...(event.event === "$exception" ? { faultCode: "mcp.failed" } : {}),
    });
    if (!metadata.success) return null;
    if (queue.length === 64) {
      queue.shift();
      dropped++;
    }
    queue.push({
      body: {
        kind: "mcp",
        event: event.event as "$mcp_tool_call" | "$mcp_initialize" | "$exception",
        metadata: metadata.data,
      },
      join: joined.data,
      at: new Date(event.timestamp).toISOString(),
    });
    if (!draining) {
      draining = true;
      exporter.track(drain());
    }
    return null;
  };
}

export function instrumentHostMcp(
  server: unknown,
  exporter: ReceiptExport,
  context: InvocationContext,
) {
  const joins = new AsyncLocalStorage<ReceiptJoin>();
  if (exporter.client && exporter.stamps.host)
    instrument(server, exporter.client, {
      context: false,
      enableConversationId: false,
      captureModel: false,
      reportMissing: false,
      serverBuild: exporter.stamps.host.build,
      identify: async () => ({ distinctId: exporter.stamps.host!.installId }),
      enableExceptionAutocapture: true,
      shouldRecordInputKey: (_key, { declared }) => declared,
      eventProperties: () => ({ pe_request_id: joins.getStore()?.requestId }),
      beforeSend: mcpBeforeSend(exporter, () => joins.getStore()),
    });
  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      const caller = context.caller;
      const join: ReceiptJoin = {
        requestId: randomUUID(),
        ...(caller?.kind === "pea"
          ? { threadId: await exporter.journal.opaqueId("thread", caller.thread) }
          : {}),
      };
      return joins.run(join, work);
    },
  };
}
