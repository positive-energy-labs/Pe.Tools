import { z } from "zod";
import type { RouteStateCommandSpec, RouteStateSpec, RouteWriteKind } from "./route-state.ts";

export interface ExternalOperation {
  command: string;
  startedAt: string;
}

export type RouteRefusalCode = "stale_revision" | "request_id_conflict" | "replay_unavailable";

export interface CommandReceipt {
  command: string;
  inputDigest: string;
  completedAt: string;
  revision: number;
  replayable: boolean;
  result?: unknown;
}

export interface RouteEnvelope<D> {
  version: 1;
  revision: number;
  doc: D;
  inFlight?: ExternalOperation;
  outcomeUnknown?: ExternalOperation;
  receipts?: Record<string, CommandReceipt>;
}

export type RoutePatch = { path: (string | number)[]; value?: unknown };
export type RouteActor = "agent" | "human";
export type RouteRefusal = {
  ok: false;
  kind?: RouteWriteKind;
  error: string;
  hint: string;
  code?: RouteRefusalCode;
};
export type RouteLanded<D> = {
  ok: true;
  envelope: RouteEnvelope<D>;
  changed: boolean;
};

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export function applyPatches<S extends z.ZodType>(
  spec: RouteStateSpec<S>,
  envelope: RouteEnvelope<z.infer<S>>,
  actor: RouteActor,
  patches: readonly RoutePatch[],
  expectedRevision: number,
): RouteLanded<z.infer<S>> | RouteRefusal {
  const stale = checkRevision(envelope, expectedRevision);
  if (stale) return stale;
  if (actor === "agent") {
    const forbidden = patches.find((patch) => !isMaskAllowed(spec.agentWriteMask, patch.path));
    if (forbidden)
      return {
        ok: false,
        kind: "refused",
        error: `patch path ${formatPath(forbidden.path)} is not agent-writable`,
        hint: `the agent write mask allows only ${spec.agentWriteMask
          .map(formatPath)
          .join(", ")} (and their subtrees); everything else is human-only.`,
      };
  }

  const draft = structuredClone(envelope.doc) as Record<string, unknown>;
  try {
    for (const patch of patches) applyPatch(draft, patch);
  } catch (error) {
    return {
      ok: false,
      kind: "error",
      error: message(error),
      hint: "patch paths must address plain document keys.",
    };
  }
  return commitDoc(spec, envelope, draft);
}

export function checkRevision(
  envelope: Pick<RouteEnvelope<unknown>, "revision">,
  expectedRevision: number,
): RouteRefusal | null {
  return expectedRevision === envelope.revision
    ? null
    : {
        ok: false,
        kind: "refused",
        code: "stale_revision",
        error: `the document moved to r${envelope.revision}`,
        hint: "re-read before patching.",
      };
}

/** Stable JSON for comparing the raw command input across retransmissions. */
export function canonicalRouteInput(input: unknown): string {
  const serialized = JSON.stringify(sortJson(input ?? {}));
  if (serialized === undefined) throw new TypeError("command input is not JSON");
  return serialized;
}

export function guardCommand<S extends z.ZodType>(
  spec: RouteStateSpec<S>,
  envelope: RouteEnvelope<z.infer<S>>,
  actor: RouteActor,
  name: string,
  input: unknown,
): { ok: true; input: unknown; command: RouteStateCommandSpec } | RouteRefusal {
  const command = spec.commands[name];
  if (!command)
    return {
      ok: false,
      kind: "error",
      error: `unknown command '${name}'`,
      hint: `available commands: ${Object.keys(spec.commands).join(", ") || "(none)"}.`,
    };
  if (command.actor === "human" && actor !== "human")
    return {
      ok: false,
      kind: "refused",
      error: `command '${name}' is human-only`,
      hint: "a human must run this command from the browser UI.",
    };
  const parsed = command.input.safeParse(input ?? {});
  if (!parsed.success)
    return {
      ok: false,
      kind: "error",
      error: `invalid input for command '${name}'`,
      hint: formatZodError(parsed.error),
    };
  if (envelope.outcomeUnknown && command.mutatesExternal && !command.recoversExternal)
    return {
      ok: false,
      kind: "refused",
      error: `command '${name}' is blocked because a prior external outcome is unknown`,
      hint: "run a recovery command successfully before another external mutation.",
    };
  return { ok: true, input: parsed.data, command };
}

export function commitDoc<S extends z.ZodType>(
  spec: RouteStateSpec<S>,
  envelope: RouteEnvelope<z.infer<S>>,
  next: unknown,
): RouteLanded<z.infer<S>> | RouteRefusal {
  const parsed = spec.schema.safeParse(next);
  if (!parsed.success)
    return {
      ok: false,
      kind: "error",
      error: "the patched document is invalid",
      hint: formatZodError(parsed.error),
    };
  return {
    ok: true,
    envelope: { ...envelope, revision: envelope.revision + 1, doc: parsed.data },
    changed: true,
  };
}

function isMaskAllowed(mask: string[][], path: (string | number)[]): boolean {
  return mask.some(
    (pattern) =>
      path.length >= pattern.length &&
      pattern.every((segment, index) => segment === "*" || segment === String(path[index])),
  );
}

function applyPatch(root: Record<string, unknown>, patch: RoutePatch): void {
  if (patch.path.length === 0) return;
  if (patch.path.some((segment) => FORBIDDEN_SEGMENTS.has(String(segment))))
    throw new Error(`patch path ${formatPath(patch.path)} contains a forbidden segment`);
  let node = root;
  for (let index = 0; index < patch.path.length - 1; index++) {
    const segment = String(patch.path[index]);
    const next = node[segment];
    if (next == null) node[segment] = {};
    else if (!isRecord(next))
      throw new Error(`patch path ${formatPath(patch.path)} is not an object`);
    node = node[segment] as Record<string, unknown>;
  }
  const last = String(patch.path.at(-1));
  if ("value" in patch) node[last] = patch.value;
  else delete node[last];
}

function formatPath(path: (string | number)[]): string {
  return `[${path.map((segment) => JSON.stringify(segment)).join(", ")}]`;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
