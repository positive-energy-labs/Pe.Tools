import { z } from "zod";
import {
  isRecord,
  message,
  type RouteStateCommandSpec,
  type RouteStatePatch,
  type RouteStateSpec,
  type RouteWriteKind,
} from "./route-state.ts";

export type RouteRefusalCode = "stale_revision";

export interface RouteEnvelope<D> {
  version: 1;
  revision: number;
  doc: D;
}

export type RouteActor = "agent" | "human";

/** Every path's answer when saved Work fails the route's schema: fail-closed, never migrated. */
export const UNREADABLE_WORK =
  "This tool's saved Work is in a shape this version cannot read, so it was left untouched; it cannot be opened here.";
/**
 * The human-only verb offered on an UNREADABLE_WORK route: `POST <route-state>/:route/start-fresh`
 * with `{}`. The old document is kept, unparsed, at `<route>:aside:<n>` (routes never contain ':');
 * an empty Work takes its place.
 */
export const START_FRESH = "start-fresh";
export const START_FRESH_ASIDE = ":aside:";
export type RouteRefusal = {
  ok: false;
  kind: RouteWriteKind;
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
  patches: readonly RouteStatePatch[],
  expectedRevision: number,
  trusted = false,
): RouteLanded<z.infer<S>> | RouteRefusal {
  const stale = checkRevision(envelope, expectedRevision);
  if (stale) return stale;
  const observed = new Set(["basis", "reading", "snapshot", "takenAt", "readback", "consent"]);
  if (!trusted && patches.some((patch) => observed.has(String(patch.path[0]))))
    return refuse(
      "refused",
      "Host observations cannot be changed by an edit",
      "Use the route's read or capture command.",
    );

  const draft = structuredClone(envelope.doc) as Record<string, unknown>;
  try {
    for (const patch of patches) applyPatch(draft, patch);
  } catch (error) {
    return refuse("error", message(error), "patch paths must address plain document keys.");
  }
  return commitDoc(
    spec,
    envelope,
    stampChanges(
      spec.reconcileEdit?.(draft, patches) ?? draft,
      envelope.doc,
      actor,
      expectedRevision,
    ),
  );
}

export function checkRevision(
  envelope: Pick<RouteEnvelope<unknown>, "revision">,
  expectedRevision: number,
): RouteRefusal | null {
  return expectedRevision === envelope.revision
    ? null
    : refuse(
        "refused",
        `the document moved to r${envelope.revision}`,
        "re-read before patching.",
        "stale_revision",
      );
}

/** Stable JSON for comparing the raw command input across retransmissions. */
export function canonicalRouteInput(input: unknown): string {
  const serialized = JSON.stringify(sortJson(input ?? {}));
  if (serialized === undefined) throw new TypeError("command input is not JSON");
  return serialized;
}

export function guardCommand<S extends z.ZodType>(
  spec: RouteStateSpec<S>,
  _envelope: RouteEnvelope<z.infer<S>>,
  actor: RouteActor,
  name: string,
  input: unknown,
): { ok: true; input: unknown; command: RouteStateCommandSpec } | RouteRefusal {
  const command = spec.commands[name];
  if (!command)
    return refuse(
      "error",
      `unknown command '${name}'`,
      `available commands: ${Object.keys(spec.commands).join(", ") || "(none)"}.`,
    );
  const parsed = command.input.safeParse(input ?? {});
  if (!parsed.success)
    return refuse("error", `invalid input for command '${name}'`, formatZodError(parsed.error));
  return { ok: true, input: parsed.data, command };
}

export function commitDoc<S extends z.ZodType>(
  spec: RouteStateSpec<S>,
  envelope: RouteEnvelope<z.infer<S>>,
  next: unknown,
): RouteLanded<z.infer<S>> | RouteRefusal {
  const writeSchema = spec.schema instanceof z.ZodObject ? spec.schema.strict() : spec.schema;
  const checked = writeSchema.safeParse(next);
  if (!checked.success)
    return refuse("error", "the patched document is invalid", formatZodError(checked.error));
  const parsed = spec.schema.safeParse(next);
  if (!parsed.success)
    return refuse("error", "the patched document is invalid", formatZodError(parsed.error));
  return {
    ok: true,
    envelope: { ...envelope, revision: envelope.revision + 1, doc: parsed.data },
    changed: true,
  };
}

function applyPatch(root: Record<string, unknown>, patch: RouteStatePatch): void {
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

export function refuse(
  kind: RouteWriteKind,
  error: string,
  hint: string,
  code?: RouteRefusalCode,
): RouteRefusal {
  return { ok: false, kind, error, hint, ...(code ? { code } : {}) };
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

/** Clients author values; the runtime stamps provenance for every changed slot. */
export function stampChanges(
  next: unknown,
  prior: unknown,
  actor: RouteActor,
  base: number,
  at = new Date().toISOString(),
  depth = 0,
): unknown {
  if (Array.isArray(next))
    return next.map((value, index) =>
      stampChanges(
        value,
        Array.isArray(prior) ? prior[index] : undefined,
        actor,
        base,
        at,
        depth + 1,
      ),
    );
  if (!isRecord(next)) return next;
  const old = isRecord(prior) ? prior : {};
  return Object.fromEntries(
    Object.entries(next).map(([key, value]) => {
      if (
        depth === 0 &&
        ["basis", "reading", "snapshot", "source", "evidence", "spec"].includes(key)
      )
        return [key, value];
      if (depth === 0 && key === "excluded" && isRecord(value)) {
        const was = isRecord(old[key]) ? old[key] : {};
        return [
          key,
          Object.fromEntries(
            Object.entries(value).map(([name, exclusion]) => [
              name,
              canonicalRouteInput(exclusion) === canonicalRouteInput(was[name])
                ? exclusion
                : isRecord(exclusion)
                  ? { ...exclusion, by: actor === "agent" ? "pea" : "human" }
                  : exclusion,
            ]),
          ),
        ];
      }
      if (
        (key === "edit" || key === "suggestion") &&
        isRecord(value) &&
        (Object.hasOwn(value, "value") || value.delete === true)
      ) {
        if (canonicalRouteInput(value) === canonicalRouteInput(old[key])) return [key, value];
        return [key, { ...value, by: actor === "agent" ? "pea" : "human", at, base }];
      }
      return [key, stampChanges(value, old[key], actor, base, at, depth + 1)];
    }),
  );
}
