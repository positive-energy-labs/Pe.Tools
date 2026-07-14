// pe-revit-cli.ts — the SDK-owned TypeScript resolver for launching the pe-revit CLI and validating
// its --json envelope.
//
// OWNED BY Pe.Revit.Sdk — DO NOT FORK. Copy this file verbatim into a consumer; the SDK ships it
// inside the Pe.Revit.Sdk nupkg under clients/ts/ so there is exactly ONE launch-chain + envelope
// implementation per language. Dependency-free — Node stdlib only (fs, path). No product imports:
// vendor/product identity and lane/source inputs are passed in by the caller, so this file stays
// generic across every product that installs a pe-revit kernel shim.
//
// Two responsibilities, both mirroring the real C# CLI:
//   1. peRevitLaunch — the four-step launch chain that decides HOW to invoke pe-revit:
//        PE_REVIT_CMD env override
//        → dev lane: repo-local tool (`dotnet tool run pe-revit --` at the tool-manifest root)
//        → installed kernel shim (%LOCALAPPDATA%\<vendor>\<product>\shims\pe-revit.cmd)
//        → bare `dotnet pe-revit` (PATH/global-tool discovery).
//   2. validatePeRevitEnvelope / PeRevitEnvelope — the exact top-level shape the CLI emits under
//      --json (source of truth: Pe.Revit.Cli/CommandEnvelope.cs Build()):
//        { result, resolved, diagnostics[{code,detail,fix}], nextSteps[], guide, related[] }.
//      A successful process exit is NOT a verdict: empty stdout, non-JSON, or a non-envelope object
//      all mean the resolved CLI did not actually answer this verb (e.g. a pre-sandbox installed
//      shim), so validation throws rather than relaying a blank/foreign 200.

import { existsSync } from "node:fs";
import { join } from "node:path";

/** A resolved launch: the executable plus the fixed args that precede the verb tokens. */
export interface PeRevitLaunch {
  readonly cmd: string;
  readonly args: readonly string[];
  /** Working directory the CLI must run from (dev lane: the tool-manifest root, so the dotnet
   * local-tool manifest and product.payloads.json resolve). Undefined = inherit the caller's cwd. */
  readonly cwd?: string;
}

/** Everything the launch chain needs, passed in by the consumer (no product imports here). */
export interface PeRevitLaunchInputs {
  /** Host lane: "dev" routes to the repo-local tool, anything else uses the installed shim chain. */
  readonly lane: string;
  /** Dev-lane working directory: the dir holding the dotnet-tools manifest (.config/dotnet-tools.json)
   * and product.payloads.json. Required when lane === "dev"; ignored otherwise. */
  readonly devWorkingDirectory: string | null;
  /** Install identity for the shim path %LOCALAPPDATA%\<vendorName>\<productName>\shims\. */
  readonly vendorName: string;
  readonly productName: string;
}

/**
 * Resolve HOW to invoke the pe-revit CLI. Resolved per call — the installed shim can appear after
 * the host process started, so this is never memoized.
 *
 * The `override`, `localAppData`, and `fileExists` parameters are injectable for tests; production
 * callers pass none and get process.env.PE_REVIT_CMD / process.env.LOCALAPPDATA / real fs.
 */
export function peRevitLaunch(
  inputs: PeRevitLaunchInputs,
  override: string | undefined = process.env.PE_REVIT_CMD,
  localAppData: string | undefined = process.env.LOCALAPPDATA,
  fileExists: (path: string) => boolean = existsSync,
): PeRevitLaunch {
  if (override?.trim()) return { cmd: override.trim(), args: [] };
  if (inputs.lane === "dev") {
    if (!inputs.devWorkingDirectory)
      throw new Error(
        "Dev-lane pe-revit launch requires devWorkingDirectory (the dotnet tool-manifest root).",
      );
    return {
      cmd: "dotnet",
      // `dotnet tool run` is manifest-only: unlike bare command discovery, it cannot fall back to an
      // installed/global pe-revit when this checkout's pinned local tool is unavailable — which is
      // exactly what we want in the dev lane (a source-linked host must run its checkout's CLI).
      args: ["tool", "run", "pe-revit", "--"],
      cwd: inputs.devWorkingDirectory,
    };
  }
  const installedShim = join(
    installRoot(inputs.vendorName, inputs.productName, localAppData),
    "shims",
    "pe-revit.cmd",
  );
  return fileExists(installedShim)
    ? { cmd: "cmd", args: ["/c", installedShim] }
    : { cmd: "dotnet", args: ["pe-revit"] };
}

/** Product root under `%LOCALAPPDATA%\<vendor>\<product>` (install receipts, shims, logs). */
export function installRoot(
  vendorName: string,
  productName: string,
  localAppData: string | undefined = process.env.LOCALAPPDATA,
): string {
  return join(localAppData ?? "", vendorName, productName);
}

/** One structured diagnostic, mirroring CommandEnvelope.Diagnostic ({ code, detail, fix }). */
export interface PeRevitDiagnostic {
  readonly code: string;
  readonly detail: string;
  /** Present (may be null) on every diagnostic the CLI emits; the optional fix hint. */
  readonly fix?: string | null;
}

/**
 * The universal pe-revit --json envelope — ONE shape for EVERY verb (source of truth:
 * Pe.Revit.Cli/CommandEnvelope.cs Build()). `result` wraps the verb payload; `resolved` states what
 * the verb resolved (root/year/session/config) so an agent never re-derives it; guide/related/
 * nextSteps are generated from the declarative VerbCatalog rows. Consumers should stop re-declaring
 * this shape and import it from here.
 */
export interface PeRevitEnvelope<Result = unknown, Resolved = unknown> {
  readonly result: Result;
  readonly resolved: Resolved;
  readonly diagnostics: readonly PeRevitDiagnostic[];
  readonly nextSteps: readonly string[];
  readonly guide: string;
  readonly related: readonly string[];
}

/**
 * Reject missing/stale/foreign CLI output instead of treating a successful process exit as a verdict.
 * Returns the raw stdout unchanged when it is a well-formed envelope (so callers can relay it
 * verbatim); throws with the reconstructed command line otherwise.
 */
export function validatePeRevitEnvelope(
  stdout: string,
  verbArgs: readonly string[],
  launch: Pick<PeRevitLaunch, "cmd" | "args">,
): string {
  const command = `${launch.cmd} ${[...launch.args, ...verbArgs].join(" ")}`.trim();
  if (!stdout.trim()) throw new Error(`pe-revit produced no output for '${command}'`);
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error(`pe-revit produced invalid JSON for '${command}'`);
  }
  if (!isPeRevitEnvelope(value))
    throw new Error(`pe-revit produced a non-envelope JSON result for '${command}'`);
  return stdout;
}

/** Structural type guard for the envelope's six required top-level fields. */
export function isPeRevitEnvelope(value: unknown): value is PeRevitEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    "result" in v &&
    "resolved" in v &&
    Array.isArray(v.diagnostics) &&
    Array.isArray(v.nextSteps) &&
    typeof v.guide === "string" &&
    Array.isArray(v.related)
  );
}

/** Parse stdout into a typed envelope (throws on any of the validate failures above). */
export function parsePeRevitEnvelope<Result = unknown, Resolved = unknown>(
  stdout: string,
  verbArgs: readonly string[],
  launch: Pick<PeRevitLaunch, "cmd" | "args">,
): PeRevitEnvelope<Result, Resolved> {
  return JSON.parse(validatePeRevitEnvelope(stdout, verbArgs, launch)) as PeRevitEnvelope<
    Result,
    Resolved
  >;
}
