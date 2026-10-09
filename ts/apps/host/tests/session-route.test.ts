import { Effect } from "effect";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkoutRootFrom } from "@pe/host-contracts/service-identity";
import { expect, test } from "vite-plus/test";
import { sessionStartArgv } from "@pe/host-contracts/pe-revit-contract";
import {
  docListArgs,
  docRecentsArgs,
  executeSessionCli,
  resolveStartProject,
  sessionStatusArgs,
} from "../src/session-route.ts";
import { peRevitLauncher, validatePeRevitEnvelope } from "../src/pe-revit-launch.ts";

const execFileAsync = promisify(execFile);

// --- payload routing and reads → CLI args -----------------------------------------------------

test("a source-linked (dev) host starts from its checkout's Pe.App; an installed host passes no --project", () => {
  expect(resolveStartProject("dev", "C:\\repo\\Pe.Tools")).toBe(
    join("C:\\repo\\Pe.Tools", "dotnet", "Pe.App", "Pe.App.csproj"),
  );
  expect(resolveStartProject("installed", null)).toBeUndefined();
  // A dev host with no resolvable source root also falls back to the installed payload.
  expect(resolveStartProject("dev", null)).toBeUndefined();
});

test("fleet and exact reads both use list; an id narrows it", () => {
  expect(sessionStatusArgs()).toEqual(["session", "list", "--json"]);
  expect(sessionStatusArgs(undefined, true)).toEqual(["session", "list", "--all", "--json"]);
  expect(sessionStatusArgs("scratch")).toEqual(["session", "list", "--id", "scratch", "--json"]);
});

test("recents and open documents are both doc list reads", () => {
  expect(docRecentsArgs()).toEqual(["doc", "list", "--recent", "--json"]);
  expect(docRecentsArgs("2026")).toEqual(["doc", "list", "--recent", "--year", "2026", "--json"]);
  expect(docListArgs()).toEqual(["doc", "list", "--json"]);
  expect(docListArgs("dev-26", "a".repeat(32))).toEqual([
    "doc",
    "list",
    "--id",
    "dev-26",
    "--doc",
    "a".repeat(32),
    "--json",
  ]);
});

// --- launcher / envelope validation ------------------------------------------------------------

test("dev host selects its checkout CLI even when an installed shim exists", () => {
  expect(
    peRevitLauncher({ lane: "dev", sourceRoot: "C:\\repo\\Pe.Tools" }, undefined, () => true),
  ).toEqual({
    cmd: "dotnet",
    args: ["tool", "run", "pe-revit", "--"],
    cwd: join("C:\\repo\\Pe.Tools"),
  });
  expect(() => peRevitLauncher({ lane: "dev", sourceRoot: null }, undefined, () => true)).toThrow(
    "requires devWorkingDirectory",
  );
});

test("installed host runs the MSI-laid pe-revit.exe shim directly", () => {
  // Only the native shim exists; a retired pe-revit.cmd is never looked for.
  const launch = peRevitLauncher({ lane: "installed", sourceRoot: null }, undefined, (path) =>
    path.toLowerCase().endsWith("pe-revit.exe"),
  );
  expect(launch.args).toEqual([]);
  expect(launch.cmd.toLowerCase().endsWith(join("shims", "pe-revit.exe").toLowerCase())).toBe(true);
});

test("session CLI rejects empty, invalid, and non-envelope output", () => {
  const launch = { cmd: "dotnet", args: ["pe-revit"] } as const;
  const args = ["session", "list", "--json"];
  expect(() => validatePeRevitEnvelope("", args, launch)).toThrow("no output");
  expect(() => validatePeRevitEnvelope("not json", args, launch)).toThrow("invalid JSON");
  expect(() => validatePeRevitEnvelope("{}", args, launch)).toThrow("non-envelope");
  // The SDK validator requires the full envelope — a guide-less envelope is exactly the
  // pre-session-CLI output it exists to reject.
  const guideless = '{"result":{},"resolved":{},"diagnostics":[],"nextSteps":[]}';
  expect(() => validatePeRevitEnvelope(guideless, args, launch)).toThrow("non-envelope");
  // The generated validator checks all nine required envelope fields instead of restating them.
  const sevenField =
    '{"result":{},"resolved":{},"diagnostics":[],"nextSteps":[],"guide":"g","related":[],"binary":{}}';
  expect(() => validatePeRevitEnvelope(sevenField, args, launch)).toThrow("non-envelope");
  const eightField =
    '{"result":{},"resolved":{},"diagnostics":[],"nextSteps":[],"guide":"g","related":[],"binary":{},"command":{}}';
  expect(() => validatePeRevitEnvelope(eightField, args, launch)).toThrow("non-envelope");
  const envelope = eightField.slice(0, -1) + ',"exitCode":0}';
  expect(validatePeRevitEnvelope(envelope, args, launch)).toBe(envelope);
  for (const exitCode of [-1, 5, 1.5, "0", null])
    expect(() =>
      validatePeRevitEnvelope(JSON.stringify({ ...JSON.parse(envelope), exitCode }), args, launch),
    ).toThrow("non-envelope");
});

test("checkout pin answers with an envelope against isolated SDK roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-tools-session-list-"));
  const repoRoot = checkoutRootFrom(import.meta.dirname)!;
  const launch = peRevitLauncher({
    lane: "dev",
    sourceRoot: repoRoot,
  });
  const args = ["session", "list", "--all", "--json"];
  const registryRoot = join(root, "registry");
  try {
    const { stdout } = await execFileAsync(launch.cmd, [...launch.args, ...args], {
      cwd: launch.cwd,
      env: {
        ...process.env,
        PE_REVIT_ADDINS_ROOT: join(root, "addins"),
        PE_SERVICE_STATE_ROOT: join(root, "services"),
        PE_SESSION_FILES_ROOT: join(root, "files"),
        PE_SESSION_REGISTRY_ROOT: registryRoot,
      },
      windowsHide: true,
    });
    expect(validatePeRevitEnvelope(stdout, args, launch)).toBe(stdout);
    expect(stdout).toContain(registryRoot.replaceAll("\\", "\\\\"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

// --- shelled execution (fake shell layer, no real CLI) ----------------------------------------

test("CLI stdout (the JSON envelope) relays verbatim, even for failed verdicts", async () => {
  const envelope = '{"result":{"sessions":[]},"diagnostics":[]}';
  const seen: string[][] = [];
  const outcome = await Effect.runPromise(
    executeSessionCli(
      sessionStatusArgs(),
      (args) => {
        seen.push([...args]);
        return Effect.succeed(envelope);
      },
      1_000,
      { action: "status" },
    ),
  );

  expect(seen).toEqual([["session", "list", "--json"]]);
  expect(outcome).toEqual({ status: 200, bodyJson: envelope });
});

// Checkout next steps use the bare forms; the route relays both advisories and refusals untouched.
const existingIdVerdicts = [
  {
    code: "session.generation-displaced",
    detail: "id 'pe.app-25' is already registered: this start mints a new generation",
    fix: "pe-revit hr --restart",
    nextSteps: ["pe-revit doc open <path>", "pe-revit stop  (when done)"],
  },
  {
    code: "session.id-in-use",
    detail: "session id 'pe.app-25' belongs to a different key",
    fix: "pass a different --id",
    nextSteps: ["pe-revit session list", "pe-revit guide session"],
  },
];

for (const verdict of existingIdVerdicts) {
  test(`a start on an existing id relays ${verdict.code} byte-for-byte`, async () => {
    const envelope = JSON.stringify({
      result: null,
      resolved: { id: "pe.app-25", how: "cwd-project" },
      diagnostics: [{ code: verdict.code, detail: verdict.detail, fix: verdict.fix }],
      nextSteps: verdict.nextSteps,
      guide: "session",
      related: [],
      binary: {},
      command: {},
      exitCode: verdict.code === "session.id-in-use" ? 3 : 0,
    });
    const outcome = await Effect.runPromise(
      executeSessionCli(sessionStartArgv({ year: "25" }), () => Effect.succeed(envelope), 1_000, {
        action: "start",
      }),
    );

    expect(outcome.status).toBe(200);
    expect(outcome.bodyJson).toBe(envelope); // untouched — not re-serialized, not re-shaped
    const body = JSON.parse(outcome.bodyJson) as {
      diagnostics: { code: string; detail: string }[];
      nextSteps: string[];
    };
    expect(body.diagnostics[0].code).toBe(verdict.code);
    expect(body.diagnostics[0].detail).toBe(verdict.detail);
    expect(body.nextSteps).toEqual(verdict.nextSteps);
  });
}

test("a spawn failure is a plain 500", async () => {
  const outcome = await Effect.runPromise(
    executeSessionCli(
      ["session", "list", "--json"],
      () => Effect.fail("pe-revit not found"),
      1_000,
      {
        action: "status",
      },
    ),
  );

  expect(outcome.status).toBe(500);
  expect(JSON.parse(outcome.bodyJson)).toMatchObject({ ok: false, error: "pe-revit not found" });
});

test("a hung CLI is a 504 that forges no envelope", async () => {
  const outcome = await Effect.runPromise(
    executeSessionCli(
      ["session", "hr", "--id", "scratch", "--restart", "--json"],
      () => Effect.never,
      50,
      { action: "hr", id: "scratch" },
    ),
  );

  expect(outcome.status).toBe(504);
  const body = JSON.parse(outcome.bodyJson) as Record<string, unknown>;
  // No `result`/`resolved`/`guide`: this route relays the SDK's envelope and never fabricates
  // one, so a caller can never mistake a route-local timeout for an SDK verdict.
  expect(Object.keys(body).sort()).toEqual(["error", "nextSteps", "ok"]);
  expect(body.ok).toBe(false);
  expect((body.nextSteps as string[])[1]).toContain(
    "pe-revit session reset --id scratch --unsaved keep|discard",
  );
});
