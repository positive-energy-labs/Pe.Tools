import { z } from "zod";
import { workKeySchema, workKey, type RouteStateSpec } from "./route-state.ts";
import type { ActionReadingKey } from "./reading.ts";
import { documentRefSchema, executionTargetSchema, type ExecutionTarget } from "./target.ts";
import { nativeProcessSchema } from "./native-process.ts";

export const workHandleSchema = z.strictObject({
  key: workKeySchema,
  revision: z.number().int().nonnegative(),
});
export type WorkHandle = z.infer<typeof workHandleSchema>;
export type WorkPath = readonly (string | number)[];
export const workPathSchema = z.array(z.union([z.string(), z.number()]));
const pathsSchema = z.array(workPathSchema);
export const consumedSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("work"),
    handle: workHandleSchema,
    paths: pathsSchema,
    snapshot: z.unknown(),
  }),
  z.strictObject({
    kind: z.literal("member"),
    pod: z.string(),
    path: z.string(),
    sha256: z.string().nullable(),
    bytesBase64: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("file"),
    path: z.string(),
    sha256: z.string().nullable(),
    bytesBase64: z.string().optional(),
  }),
  z.strictObject({ kind: z.literal("document-mark"), ref: documentRefSchema, takenAt: z.string() }),
  z.strictObject({
    kind: z.literal("incarnation"),
    target: executionTargetSchema,
    process: nativeProcessSchema,
  }),
  z.strictObject({ kind: z.literal("receipt"), id: z.string(), key: z.string() }),
  z.strictObject({
    kind: z.literal("capture"),
    sha256: z.string(),
    bytesBase64: z.string(),
    origin: z.strictObject({ kind: z.literal("url"), url: z.url() }),
    capturedAt: z.string(),
  }),
  z.strictObject({
    kind: z.literal("census"),
    session: z.string(),
    openIds: z.array(z.string()),
    process: nativeProcessSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("directory"), path: z.string(), snapshot: z.unknown() }),
  z.strictObject({ kind: z.literal("catalog"), snapshot: z.unknown() }),
]);
export type Consumed = z.infer<typeof consumedSchema>;
export const claimSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("receipt"), id: z.string() }),
  z.strictObject({ kind: z.literal("session-slot"), selector: z.unknown() }),
  z.strictObject({ kind: z.literal("reconciliation"), id: z.string() }),
]);
export type Claim = z.infer<typeof claimSchema>;
export const commandRefusalSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stale_revision"), handle: workHandleSchema, live: z.number() }),
  z.strictObject({ kind: z.literal("stale"), consumed: z.array(consumedSchema) }),
  z.strictObject({ kind: z.literal("claimed"), claim: claimSchema, by: z.string() }),
  z.strictObject({ kind: z.literal("run"), code: z.string(), message: z.string() }),
  z.strictObject({ kind: z.literal("trust"), code: z.string(), message: z.string() }),
  z.strictObject({ kind: z.literal("domain"), code: z.string(), message: z.string() }),
]);
export type CommandRefusal = z.infer<typeof commandRefusalSchema>;
export function commandCounts(
  rows: readonly { state: import("./action-receipts.ts").ActionReceipt["state"] }[],
) {
  const counts = { completed: 0, failed: 0, cancelled: 0, running: 0, unresolved: 0 };
  for (const row of rows) {
    switch (row.state) {
      case "succeeded":
        counts.completed++;
        break;
      case "failed":
        counts.failed++;
        break;
      case "cancelled":
        counts.cancelled++;
        break;
      case "waiting":
      case "running":
        counts.running++;
        break;
      case "unknown":
      case "incomplete":
        counts.unresolved++;
        break;
      default: {
        const unhandled: never = row.state;
        throw new TypeError(`Unknown command state ${unhandled}`);
      }
    }
  }
  return counts;
}
export type CommandCounts = ReturnType<typeof commandCounts>;
export type ActionNeed =
  | "nothing"
  | "session"
  | "document"
  | "project-document"
  | "family-document";

/** Locations stop at cells; metadata and observations cannot become editable locations. */
type IsCell<T> = string extends keyof T
  ? false
  : "edit" extends keyof T
    ? "suggestion" extends keyof T
      ? true
      : false
    : false;
type CellPath<T> = {
  [K in keyof T & string]: IsCell<NonNullable<T[K]>> extends true
    ? readonly [K]
    : NonNullable<T[K]> extends Record<string, infer V>
      ? IsCell<NonNullable<V>> extends true
        ? readonly [K, "*"]
        : never
      : never;
}[keyof T & string];

export function workLocations<S extends z.ZodType>(
  spec: RouteStateSpec<S>,
  editable: readonly CellPath<z.infer<S>>[],
) {
  return { ...spec, editable };
}

/** A portable operation contract. Execution belongs to the host journal. */
export interface Command<I = unknown, R = unknown> {
  says: string;
  dirties: readonly ActionReadingKey[];
  needs: ActionNeed;
  effect: "query" | "command";
  input: z.ZodType<I>;
  result?: z.ZodType<R>;
  announce?: true;
  /** Native implementation keys hidden when the semantic command owns the callable path. */
  native?: readonly string[];
  target?(input: I): ExecutionTarget;
  work?: {
    route: string;
    bind(input: Omit<I, "work">, handle: WorkHandle): I;
  };
}

export function receiptsForWork<R extends { consumes: Consumed[]; refusal?: CommandRefusal }>(
  rows: readonly R[],
  key: import("./route-state.ts").WorkKey,
): R[] {
  const id = workKey(key);
  const matches = (items: Consumed[]) =>
    items.some((item) => item.kind === "work" && workKey(item.handle.key) === id);
  return rows.filter(
    (row) =>
      matches(row.consumes) ||
      (row.refusal?.kind === "stale_revision" && workKey(row.refusal.handle.key) === id) ||
      (row.refusal?.kind === "stale" && matches(row.refusal.consumed)),
  );
}

export function busyForWork<R extends { consumes: Consumed[]; state: string }>(
  rows: readonly R[],
  key: import("./route-state.ts").WorkKey,
): R[] {
  return receiptsForWork(rows, key).filter((row) =>
    ["waiting", "running", "unknown", "incomplete"].includes(row.state),
  );
}

/** Expand the declared locations without interpreting a user's property names as cell metadata. */
export function editableCells(
  doc: unknown,
  paths: readonly WorkPath[],
): { path: (string | number)[]; cell: import("./draft.ts").CellLike }[] {
  const cells: ReturnType<typeof editableCells> = [];
  const visit = (value: unknown, parts: WorkPath, path: (string | number)[]) => {
    if (!parts.length) {
      if (value !== null && typeof value === "object")
        cells.push({ path, cell: value as import("./draft.ts").CellLike });
      return;
    }
    if (value === null || typeof value !== "object") return;
    const [part, ...rest] = parts;
    if (part === "*")
      for (const key of Object.keys(value))
        visit((value as Record<string, unknown>)[key], rest, [...path, key]);
    else visit((value as Record<string | number, unknown>)[part!], rest, [...path, part!]);
  };
  for (const path of paths) visit(doc, path, []);
  return cells;
}

export function workCounts(doc: unknown, paths: readonly WorkPath[]) {
  const cells = editableCells(doc, paths).map((entry) => entry.cell);
  return {
    proposals: cells.filter((cell) => cell.suggestion != null).length,
    unfinished: cells.filter((cell) => cell.edit != null || cell.suggestion != null).length,
  };
}

/** Explicit association, shared by the browser binder and host discovery. */
export function workCommand<S extends z.ZodRawShape, const C extends Command>(
  route: string,
  command: C & { input: z.ZodObject<S> },
) {
  const work = { work: workHandleSchema.optional() };
  // Leaf contracts reserve `work` for this binder; safeExtend also retains their refinements.
  const input = command.input.safeExtend(
    work as z.SafeExtendShape<S, typeof work> & Partial<Record<keyof S, z.core.SomeType>>,
  );
  return {
    ...command,
    input,
    work: {
      route,
      bind: (value: Omit<z.infer<typeof input>, "work">, handle: WorkHandle) => ({
        ...value,
        work: handle,
      }),
    },
  };
}

/** Work remains mutable revisioned state; commands retain immutable intent separately. */
export interface Tool<C extends Record<string, Command> = Record<string, Command>> {
  name: string;
  says: string;
  work?: RouteStateSpec<z.ZodType> & { editable: readonly WorkPath[] };
  commands: C;
}
