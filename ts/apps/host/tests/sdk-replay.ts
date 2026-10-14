/**
 * Recorded SDK envelopes are the only base a host test fake may answer from (E1: rounds 2, 7 and 8
 * were green against invented envelopes and red in Revit). `sdk-envelopes/<verb>.<state>.json` are
 * real `pe-revit … --json` stdout from a controlled session (`tools/acceptance.py sdk`), with the
 * profile path normalized. `replay` starts a fake from one; `recordedProblems` (wired for every host
 * test by sdk-contract-setup.ts) refuses any parsed envelope whose shape the SDK never sent.
 * Re-record after an SDK pin bump: run each verb through `tools/acceptance.py sdk` and copy the
 * envelope here.
 */
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

/** One exemplar per discriminator (`case`, `kind`) so union rows are compared with their own kind. */
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

function compare(real: Json, fake: unknown, path: string, problems: string[]) {
  // ponytail: a field the recording saw as null (or an empty array) accepts any fake value; record a
  // richer envelope to cover it.
  if (real === null || fake === null || fake === undefined) return;
  if (kind(real) !== kind(fake)) {
    problems.push(`${path}: SDK sends ${kind(real)}, fake sends ${kind(fake)}`);
    return;
  }
  if (Array.isArray(real)) {
    const shapes = exemplars(real);
    for (const [i, row] of (fake as unknown[]).entries()) {
      const tag =
        kind(row) === "object" ? String((row as Shape).case ?? (row as Shape).kind ?? "") : "";
      const shape = shapes.get(tag) ?? (shapes.size === 1 && !tag ? shapes.get("") : undefined);
      if (shape) compare(shape, row, `${path}[${i}]`, problems);
    }
    return;
  }
  if (kind(real) !== "object") return;
  const realShape = real as Shape;
  const fakeShape = fake as Record<string, unknown>;
  for (const key of Object.keys(fakeShape))
    if (!(key in realShape)) problems.push(`${path}.${key}: the SDK never sends it`);
  for (const key of Object.keys(realShape))
    if (!(key in fakeShape)) problems.push(`${path}.${key}: the SDK always sends it`);
  for (const key of Object.keys(realShape))
    if (key in fakeShape) compare(realShape[key]!, fakeShape[key], `${path}.${key}`, problems);
}

/** A CLI-level refusal (bad invocation, output exists) answers `result: {}`: its state is `none`. */
const stateOf = (envelope: Record<string, unknown>) =>
  String((envelope.result as Record<string, unknown> | null)?.state ?? "none");

/** Problems with an envelope a fake produced for `args`; empty when it matches a recording. */
export function recordedProblems(args: readonly string[], stdout: string): string[] {
  const verb = verbOf(args);
  const fake = JSON.parse(stdout) as Record<string, unknown>;
  // The demo lane is a product simulation that names itself; it is not a test fake.
  if ((fake.command as Record<string, unknown> | null)?.commandRule === "simulated-demo") return []; // demo-owner.ts SIMULATED_SDK
  const exact = recorded.get(`${verb}.${stateOf(fake)}`);
  // A state with no recording of its own is held to the envelope, not to another state's result.
  // A verb never recorded (bootstrap install mutates the machine) keeps the recorded frame, and its
  // result is held to the vendored contract alone.
  const real = exact ?? [...recorded].find(([name]) => name.startsWith(`${verb}.`))?.[1] ?? frame;
  if (real === frame && !contractShape(fake.result))
    return [`no recorded envelope for '${verb}' and its result matches no contract shape`];
  const problems: string[] = [];
  // A union result (op result: receipt, response, late, state-only) the recording did not take is
  // held to the vendored contract: its keys must be exactly one generated interface's.
  const union = exact && !sameKeys(exact.result, fake.result) && contractShape(fake.result);
  compare(exact && !union ? real : { ...real, result: null }, fake, verb, problems);
  return problems;
}

const sameKeys = (a: unknown, b: unknown) =>
  kind(a) === "object" &&
  kind(b) === "object" &&
  Object.keys(a as object)
    .sort()
    .join() ===
    Object.keys(b as object)
      .sort()
      .join();

const contract = readFileSync(
  join(
    import.meta.dirname,
    "../../../packages/host-contracts/src/vendor/generated/pe-revit-contract.ts",
  ),
  "utf8",
);
const interfaces = [...contract.matchAll(/export interface \w+(?:<\w+>)? \{([^}]*)\}/g)].map((m) =>
  [...m[1]!.matchAll(/readonly (\w+)\??:/g)]
    .map((k) => k[1])
    .sort()
    .join(),
);
const contractShape = (value: unknown) =>
  kind(value) === "object" &&
  interfaces.includes(
    Object.keys(value as object)
      .sort()
      .join(),
  );

const merge = (base: Json, patch: unknown, path: string): Json => {
  if (patch === undefined) return base;
  if (kind(base) === "object" && kind(patch) === "object") {
    const out = { ...(base as Shape) };
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (!(key in out)) throw new Error(`${path}.${key}: the SDK never sends it`);
      out[key] = merge(out[key]!, value, `${path}.${key}`);
    }
    return out;
  }
  if (Array.isArray(patch)) {
    const shapes = Array.isArray(base) ? exemplars(base) : new Map<string, Shape>();
    return patch.map((row, i) => {
      if (kind(row) !== "object") return row as Json;
      const tag = String((row as Shape).case ?? (row as Shape).kind ?? "");
      const shape = shapes.get(tag) ?? (shapes.size === 1 ? [...shapes.values()][0] : undefined);
      return shape ? merge(shape, row, `${path}[${i}]`) : (row as Json);
    });
  }
  return patch as Json;
};

/** A recorded envelope for `verb` (`doc-open`, …) with `patch` laid over it; stdout text. */
export function replay(verb: string, patch: Record<string, unknown> = {}, state = "ok"): string {
  const base = recorded.get(`${verb}.${state}`);
  if (!base) throw new Error(`no recorded envelope '${verb}.${state}'`);
  return JSON.stringify(merge(base, patch, verb));
}

/** A fake's answer to `args`: the recording of its verb and state with `fields` laid over it, or the
 * recorded frame around `fields` when that state was never recorded (then held to the contract). */
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
