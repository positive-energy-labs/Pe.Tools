// SDK-owned copy-in client. The generated contract defines the eight-field envelope.
// Process success is not a verdict; validation rejects empty, non-JSON, and non-envelope output.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type {
  Diagnostic,
  Envelope,
  Resolved as GeneratedResolved,
} from "@pe/host-contracts/pe-revit-contract";

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
export type PeRevitDiagnostic = Diagnostic;

/**
 * The universal pe-revit --json envelope — ONE shape for EVERY verb (source of truth:
 * Pe.Revit.Cli/CommandEnvelope.cs Build()). `result` wraps the verb payload; `resolved` states what
 * the verb resolved (root/year/session/config) so an agent never re-derives it; guide/related/
 * nextSteps are generated from the declarative VerbCatalog rows. Consumers should stop re-declaring
 * this shape and import it from here.
 */
export type PeRevitEnvelope<Result = unknown, Resolution = GeneratedResolved | null> =
  Omit<Envelope<Result>, "resolved"> & { readonly resolved: Resolution };

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

/** Structural type guard for the envelope's eight required top-level fields. */
export function isPeRevitEnvelope(value: unknown): value is PeRevitEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    "result" in v &&
    "resolved" in v &&
    Array.isArray(v.diagnostics) &&
    typeof v.binary === "object" && v.binary !== null &&
    typeof v.command === "object" && v.command !== null &&
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

export function run(
  argv: readonly string[],
  launch?: PeRevitLaunch,
): Promise<Envelope<unknown>>;
export function run<T>(
  argv: readonly string[],
  launch?: PeRevitLaunch,
): Promise<Envelope<T>>;
export function run<T>(
  argv: readonly string[],
  launch: PeRevitLaunch = { cmd: "dotnet", args: ["pe-revit"] },
): Promise<Envelope<T>> {
  return new Promise((resolve, reject) => {
    const child = spawn(launch.cmd, [...launch.args, ...argv], {
      cwd: launch.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(JSON.parse(validatePeRevitEnvelope(stdout, argv, launch)) as Envelope<T>);
      } catch (error) {
        reject(new Error(`${(error as Error).message}${stderr.trim() ? `\n${stderr.trim()}` : ""}`));
      }
    });
  });
}
