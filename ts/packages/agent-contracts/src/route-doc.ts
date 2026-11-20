import { type Author } from "./author.ts";
import { z } from "zod";
import {
  isRecord,
  message,
  type RouteStatePatch,
  type RouteStateSpec,
  type RouteWriteKind,
} from "./route-state.ts";

export type RouteRefusalCode = "stale_revision";

export interface RouteEnvelope<D> {
  version: 1;
  /** Current decoded Work schema stamp. */
  schemaVersion?: number;
  revision: number;
  doc: D;
}

export type WorkAuthor = Author;

export type RouteRefusal = {
  ok: false;
  kind: RouteWriteKind;
  error: string;
  hint: string;
  code?: RouteRefusalCode;
  revision?: number;
};
export type RouteLanded<D> = {
  ok: true;
  envelope: RouteEnvelope<D>;
  changed: boolean;
};

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export function applyPatches<S extends z.ZodType>(
  spec: RouteStateSpec<S>,
  envelope: RouteEnvelope<unknown>,
  by: WorkAuthor,
  patches: readonly RouteStatePatch[],
  expectedRevision: number,
  trusted = false,
  restore = false,
): RouteLanded<z.infer<S>> | RouteRefusal {
  const stale = checkRevision(envelope, expectedRevision);
  if (stale) return stale;
  if (
    !restore &&
    patches.some((patch) => patch.path.at(-1) === "invalid" || suppliedInvalid(patch.value))
  )
    return refuse(
      "refused",
      "Caller edits cannot supply invalid markers",
      "Replace the cell with a valid edit.",
    );
  const observed = new Set(["basis", "reading", "snapshot", "takenAt", "readback", "consent"]);
  if (!trusted && patches.some((patch) => observed.has(String(patch.path[0]))))
    return refuse(
      "refused",
      "Host observations cannot be changed by an edit",
      "Use the route's read or capture command.",
    );

  if (
    !trusted &&
    !restore &&
    patches.some(
      (patch) =>
        (patch.path.at(-1) === "by" && patch.path.at(-2) === "edit") ||
        (patch.path.at(-1) === "edit" &&
          isRecord(patch.value) &&
          Object.hasOwn(patch.value, "by")) ||
        suppliedStamp(patch.value),
    )
  )
    return refuse(
      "refused",
      "Caller edits cannot supply by",
      "The host stamps the accepted edit's author.",
    );

  let draft = structuredClone(envelope.doc) as Record<string, unknown>;
  try {
    for (const patch of patches) {
      if (restore && patch.path.length === 0) draft = structuredClone(patch.value) as typeof draft;
      else applyPatch(draft, structuredClone(patch));
    }
  } catch (error) {
    return refuse("error", message(error), "patch paths must address plain document keys.");
  }
  const invalidEdit = restore ? null : spec.validateEdit?.(draft, envelope.doc, by);
  if (invalidEdit) return refuse("refused", invalidEdit, "Correct the staged edit and try again.");
  const stamped = restore ? draft : stampChanges(draft, envelope.doc, by, expectedRevision);
  const checked = commitDoc(spec, envelope, stamped);
  if (!checked.ok || restore || !spec.reconcileEdit) return checked;
  return commitDoc(
    spec,
    envelope,
    spec.reconcileEdit(checked.envelope.doc, patches) ?? checked.envelope.doc,
  );
}

const suppliedStamp = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(suppliedStamp)
    : isRecord(value) &&
      Object.entries(value).some(
        ([key, child]) =>
          (key === "edit" && isRecord(child) && Object.hasOwn(child, "by")) || suppliedStamp(child),
      );

const suppliedInvalid = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(suppliedInvalid)
    : isRecord(value) &&
      (Object.hasOwn(value, "invalid") || Object.values(value).some(suppliedInvalid));

/** Replace a container when its keys change, so inverse replay preserves key order as well. */
export function routeDocDelta(
  before: unknown,
  after: unknown,
  path: RouteStatePatch["path"] = [],
  keyedFields: readonly string[] = [],
): RouteStatePatch[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  // Keyed Work records have identity by key. Do not widen deletion/insertion history
  // to the entire map merely to preserve object enumeration order.
  if (
    path.length === 1 &&
    keyedFields.includes(String(path[0])) &&
    isRecord(before) &&
    isRecord(after)
  )
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) =>
      routeDocDelta(before[key], after[key], [...path, key]),
    );

  if (
    isRecord(before) &&
    isRecord(after) &&
    JSON.stringify(Object.keys(before)) === JSON.stringify(Object.keys(after))
  )
    return Object.keys(before).flatMap((key) =>
      routeDocDelta(before[key], after[key], [...path, key], keyedFields),
    );
  return [{ path, ...(after === undefined ? {} : { value: structuredClone(after) }) }];
}

export function checkRevision(
  envelope: Pick<RouteEnvelope<unknown>, "revision">,
  expectedRevision: number,
): RouteRefusal | null {
  return expectedRevision === envelope.revision
    ? null
    : {
        ...refuse(
          "refused",
          `the document moved to r${envelope.revision}`,
          "re-read before patching.",
          "stale_revision",
        ),
        revision: envelope.revision,
      };
}

/** Stable JSON for comparing the raw command input across retransmissions. */
export function canonicalRouteInput(input: unknown): string {
  const serialized = JSON.stringify(sortJson(input ?? {}));
  if (serialized === undefined) throw new TypeError("command input is not JSON");
  return serialized;
}

export function commitDoc<S extends z.ZodType>(
  spec: RouteStateSpec<S>,
  envelope: RouteEnvelope<unknown>,
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

export function applyPatch(root: Record<string, unknown>, patch: RouteStatePatch): void {
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
  return (
    error.issues
      .map((issue) =>
        issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
      )
      .join("; ") +
    (error.issues.some((issue) => issue.path.includes("edit"))
      ? ' Cell edits wrap the typed value: patch path ["equipmentFlows","<id>","edit"] with value {"value":1050}. For another cell, read its value schema.'
      : "")
  );
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
  by: WorkAuthor,
  base: number,
  at = new Date().toISOString(),
  depth = 0,
): unknown {
  if (Array.isArray(next))
    return next.map((value, index) =>
      stampChanges(value, Array.isArray(prior) ? prior[index] : undefined, by, base, at, depth + 1),
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
                  ? { ...exclusion, by: by }
                  : exclusion,
            ]),
          ),
        ];
      }
      if (
        key === "edit" &&
        isRecord(value) &&
        (Object.hasOwn(value, "value") || value.delete === true)
      ) {
        if (canonicalRouteInput(value) === canonicalRouteInput(old[key])) return [key, value];
        return [key, { ...value, by: by, at, base }];
      }
      return [key, stampChanges(value, old[key], by, base, at, depth + 1)];
    }),
  );
}
