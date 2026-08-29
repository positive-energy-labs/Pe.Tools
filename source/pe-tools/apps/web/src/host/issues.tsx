import type { ReactNode } from "react";

import type { HostErrorKind } from "@pe/host-contracts/contracts";
import { HostCallError } from "@pe/host-contracts/operation-types";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";

export type HostIssueKind =
  | "disconnected"
  | "bridge_busy"
  | "invalid_request"
  | "schema_mismatch"
  | "conflict"
  | "host_failure"
  | "unknown";

export type HostIssue = {
  kind: HostIssueKind;
  title: string;
  message: string;
  status?: number;
  operationKey?: string;
  activeOperation?: string;
  retryHint?: string;
  bridgePrecondition?: string;
  fieldIssues?: HostIssueFieldIssue[];
  raw?: unknown;
};

export type HostIssueFieldIssue = {
  path: string;
  message: string;
  code?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readFieldIssues(detail: unknown): HostIssueFieldIssue[] | undefined {
  if (!isRecord(detail) || !Array.isArray(detail.issues)) return undefined;
  const issues = detail.issues.flatMap((issue): HostIssueFieldIssue[] => {
    if (!isRecord(issue)) return [];
    const pathValue = issue.path;
    const path = Array.isArray(pathValue)
      ? pathValue.map(formatPathPart).join(".")
      : typeof pathValue === "string" || typeof pathValue === "number"
        ? String(pathValue)
        : "$";
    return [
      {
        path: path.length > 0 ? path : "$",
        message: readString(issue, "message") ?? "Invalid value",
        code: readString(issue, "code"),
      },
    ];
  });
  return issues.length > 0 ? issues : undefined;
}

function formatPathPart(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "?";
}

// C#-owned HostErrorKind → display kind. The host emits the machine kind in
// problem.extensions.kind, so we map it instead of regexing the message.
const SERVER_KIND: Record<HostErrorKind, HostIssueKind> = {
  Disconnected: "disconnected",
  BridgeBusy: "bridge_busy",
  InvalidRequest: "invalid_request",
  Conflict: "conflict",
  HostFailure: "host_failure",
};

function classifyHostCall(error: HostCallError, problem: Record<string, unknown>): HostIssueKind {
  // Client-side failures never reach the host, so they carry no server kind.
  const message = error.message.toLowerCase();
  if (error.status === 0 && message.includes("request is invalid")) return "invalid_request";
  if (message.includes("unexpected shape")) return "schema_mismatch";

  const serverKind = readString(problem, "kind");
  if (serverKind && serverKind in SERVER_KIND) return SERVER_KIND[serverKind as HostErrorKind];
  return "host_failure";
}

function defaultTitle(kind: HostIssueKind): string {
  switch (kind) {
    case "disconnected":
      return "Host disconnected";
    case "bridge_busy":
      return "Bridge busy";
    case "invalid_request":
      return "Invalid request";
    case "schema_mismatch":
      return "Schema mismatch";
    case "conflict":
      return "Conflict";
    case "host_failure":
      return "Host failure";
    case "unknown":
      return "Unknown failure";
  }
}

export function toHostIssue(error: unknown, fallbackTitle = "Host failure"): HostIssue {
  if (error instanceof HostCallError) {
    // ASP.NET ProblemDetails.Extensions serialize as top-level members, so every
    // host-added field (kind, operationKey, retryHint, …) lives on `detail` directly.
    const detail = isRecord(error.problem) ? error.problem : {};
    const kind = classifyHostCall(error, detail);
    return {
      kind,
      title: readString(detail, "title") ?? defaultTitle(kind),
      message: readString(detail, "detail") ?? error.message,
      status: error.status || readNumber(detail, "status"),
      operationKey: readString(detail, "operationKey"),
      activeOperation: readString(detail, "activeOperation"),
      retryHint: readString(detail, "retryHint"),
      bridgePrecondition: readString(detail, "bridgePrecondition"),
      fieldIssues: readFieldIssues(error.problem),
      raw: error.problem,
    };
  }

  if (error instanceof Error) {
    return {
      kind: "unknown",
      title: fallbackTitle,
      message: error.message,
      raw: error,
    };
  }

  return {
    kind: "unknown",
    title: fallbackTitle,
    message: String(error),
    raw: error,
  };
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

export function HostIssuePanel({
  issue,
  action,
  compact = false,
}: {
  issue?: HostIssue;
  action?: ReactNode;
  compact?: boolean;
}) {
  if (!issue) return null;

  const caution = issue.kind === "conflict" || issue.kind === "bridge_busy";
  return (
    <ArtifactFrame
      head={
        <div className="flex w-full items-start justify-between gap-3">
          <OutcomeLine
            kind={caution ? "error" : "refused"}
            label={issue.title}
            says={issue.message}
          />
          {action}
        </div>
      }
    >
      <div className={compact ? "p-2" : "p-3"}>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {issue.status ? <HostIssueMeta>status {issue.status}</HostIssueMeta> : null}
          {issue.operationKey ? <HostIssueMeta>{issue.operationKey}</HostIssueMeta> : null}
          {issue.activeOperation ? (
            <HostIssueMeta>active {issue.activeOperation}</HostIssueMeta>
          ) : null}
          {issue.retryHint ? <HostIssueMeta>{issue.retryHint}</HostIssueMeta> : null}
          {issue.bridgePrecondition ? (
            <HostIssueMeta>{issue.bridgePrecondition}</HostIssueMeta>
          ) : null}
        </div>
        {issue.fieldIssues?.length ? (
          <ul className="mt-2">
            {issue.fieldIssues.slice(0, 5).map((fieldIssue) => (
              <li key={`${fieldIssue.path}:${fieldIssue.message}`}>
                <code>{fieldIssue.path}</code>: {fieldIssue.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ArtifactFrame>
  );
}

function HostIssueMeta({ children }: { children: ReactNode }) {
  return <FactChip title="Host diagnostic detail.">{children}</FactChip>;
}

export function HostConnectionPill({ connected, label }: { connected: boolean; label?: string }) {
  return (
    <FactChip tone={connected ? "done" : "meta"} title="Current host connection state.">
      {connected ? (label ?? "Connected") : "Disconnected"}
    </FactChip>
  );
}
