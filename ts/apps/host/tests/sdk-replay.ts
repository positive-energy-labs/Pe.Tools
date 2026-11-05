/** Recorded transport inputs. Production pe-revit-cli owns runtime wire decoding. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Binary, CommandContext } from "@pe/host-contracts/pe-revit-contract";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Shape = { [key: string]: Json };

const folder = join(import.meta.dirname, "sdk-envelopes");
const recorded = new Map<string, Shape>(
  readdirSync(folder).map((file) => [
    file.replace(/\.json$/, ""),
    JSON.parse(readFileSync(join(folder, file), "utf8")) as Shape,
  ]),
);

const frame = recorded.get("session-list.ok")!;
/** The recorded `binary` and `command` of every envelope; a fake answers with these, never `{}`. */
export const sdkBinary = frame.binary as unknown as Binary;
export const sdkCommand = frame.command as unknown as CommandContext;

const families = new Set(["session", "doc", "op", "sdk", "update", "bootstrap"]);
const shortForms: Record<string, string> = {
  open: "doc-open",
  start: "session-start",
  stop: "session-stop",
  hr: "session-hr",
};

/** `doc open <path> --json` → `doc-open`; the checkout's short forms name their family verb. */
const verbOf = (args: readonly string[]): string => {
  const words = args.filter((arg) => !arg.startsWith("-"));
  // `doc list --holdings` answers a narrower document row than `doc list`.
  if (families.has(words[0] ?? ""))
    return `${words[0]}-${words[1]}${args.includes("--holdings") ? "-holdings" : ""}`;
  return shortForms[words[0] ?? ""] ?? words[0] ?? "";
};

const kind = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
const exemplars = (rows: Json[]) => {
  const byCase = new Map<string, Shape>();
  for (const row of rows)
    if (kind(row) === "object") {
      const shape = row as Shape;
      const tag = String(shape.case ?? shape.kind ?? "");
      byCase.set(tag, { ...byCase.get(tag), ...shape });
    }
  return byCase;
};

const merge = (base: Json, patch: unknown): Json => {
  if (patch === undefined) return base;
  if (kind(base) === "object" && kind(patch) === "object") {
    const out = { ...(base as Shape) };
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      out[key] = merge(out[key]!, value);
    }
    return out;
  }
  if (Array.isArray(patch)) {
    const shapes = Array.isArray(base) ? exemplars(base) : new Map<string, Shape>();
    return patch.map((row) => {
      if (kind(row) !== "object") return row as Json;
      const tag = String((row as Shape).case ?? (row as Shape).kind ?? "");
      const shape = shapes.get(tag) ?? (shapes.size === 1 ? [...shapes.values()][0] : undefined);
      return shape ? merge(shape, row) : (row as Json);
    });
  }
  return patch as Json;
};

/** A recorded envelope for `verb` (`doc-open`, …) with `patch` laid over it; stdout text. */
export function replay(verb: string, patch: Record<string, unknown> = {}, state = "ok"): string {
  const base = recorded.get(`${verb}.${state}`);
  if (!base) throw new Error(`no recorded envelope '${verb}.${state}'`);
  return JSON.stringify(merge(base, patch));
}

/** A fake's answer to `args`: the recording of its verb and state with `fields` laid over it, or the
 * recorded frame around `fields` when that state was never recorded (production decodes it). */
export function replayAnswer(args: readonly string[], fields: Record<string, unknown>): string {
  const verb = verbOf(args);
  const state = String((fields.result as Record<string, unknown> | null)?.state ?? "none");
  if (recorded.has(`${verb}.${state}`)) return replay(verb, fields, state);
  const { binary, command, nextSteps, guide, related } = frame;
  return JSON.stringify({
    binary,
    command,
    nextSteps,
    guide,
    related,
    resolved: null,
    diagnostics: [],
    exitCode: 0,
    ...fields,
  });
}
