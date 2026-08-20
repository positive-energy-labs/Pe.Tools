import { Effect } from "effect";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  executeSessionCli,
  parseSessionActionRequest,
  resolveStartProject,
  sessionActionTimeoutMs,
  sessionCliArgs,
  sessionStatusArgs,
  type SessionActionRequest,
} from "../src/session-route.ts";
import { peRevitLauncher, validatePeRevitEnvelope } from "../src/pe-revit-launch.ts";

function parsed(body: unknown): SessionActionRequest {
  const result = parseSessionActionRequest(body);
  if (!result.ok) throw new Error(result.error);
  return result.request;
}

// --- action → CLI args mapping ----------------------------------------------------------------

test("start on a source-linked (dev) host uses the checkout's Pe.App project", () => {
  const project = resolveStartProject("dev", "C:\\repo\\Pe.Tools\\source\\pe-tools");
  expect(project).toBe(join("C:\\repo\\Pe.Tools", "source", "Pe.App", "Pe.App.csproj"));

  const args = sessionCliArgs(parsed({ action: "start", year: 25, id: "scratch" }), project);
  expect(args).toEqual([
    "session",
    "start",
    "--project",
    join("C:\\repo\\Pe.Tools", "source", "Pe.App", "Pe.App.csproj"),
    "--year",
    "25",
    "--id",
    "scratch",
    "--origin",
    "web",
    "--json",
  ]);
});

test("start on an installed-lane host passes NO --project: project-less start IS installed", () => {
  expect(resolveStartProject("installed", null)).toBeUndefined();
  // A dev host with no resolvable source root also falls back to the installed payload.
  expect(resolveStartProject("dev", null)).toBeUndefined();

  const args = sessionCliArgs(parsed({ action: "start", year: "25" }), undefined);
  expect(args).toEqual(["session", "start", "--year", "25", "--origin", "web", "--json"]);
  // The retired flags must never reappear: lane is derived from the payload source, and start
  // blocks to ready by default (the opt-out is --no-wait, which this route never wants).
  expect(args).not.toContain("--installed");
  expect(args).not.toContain("--wait");
});

test("start carries an optional --doc for the end-user case", () => {
  expect(
    sessionCliArgs(parsed({ action: "start", year: "26", doc: "Tower.rvt" }), undefined),
  ).toEqual([
    "session",
    "start",
    "--year",
    "26",
    "--doc",
    "Tower.rvt",
    "--origin",
    "web",
    "--json",
  ]);
});

test("stop/restart/converge map to --id verbs; stop honors force", () => {
  expect(sessionCliArgs(parsed({ action: "restart", id: "scratch" }), undefined)).toEqual([
    "session",
    "restart",
    "--id",
    "scratch",
    "--json",
  ]);
  expect(sessionCliArgs(parsed({ action: "stop", id: "scratch", force: true }), undefined)).toEqual(
    ["session", "stop", "--id", "scratch", "--force", "--json"],
  );
  expect(
    sessionCliArgs(parsed({ action: "converge", id: "scratch", timeoutSeconds: 300 }), undefined),
  ).toEqual(["session", "converge", "--id", "scratch", "--timeout-seconds", "300", "--json"]);
});

test("status args pass an optional id filter", () => {
  expect(sessionStatusArgs()).toEqual(["session", "status", "--json"]);
  expect(sessionStatusArgs("scratch")).toEqual(["session", "status", "--id", "scratch", "--json"]);
});

test("action body validation mirrors the CLI invocation contract", () => {
  expect(parseSessionActionRequest(null)).toMatchObject({ ok: false });
  expect(parseSessionActionRequest({ action: "destroy" })).toMatchObject({ ok: false });
  expect(parseSessionActionRequest({ action: "wait", id: "s" })).toMatchObject({ ok: false });
  expect(parseSessionActionRequest({ action: "start" })).toMatchObject({ ok: false }); // no year
  expect(parseSessionActionRequest({ action: "stop" })).toMatchObject({ ok: false }); // no id
  expect(parseSessionActionRequest({ action: "start", year: 25 })).toMatchObject({ ok: true });
  // converge with no id is legal: the SDK resolver owns implicit-single resolution and this
  // route must not re-implement a stricter one.
  expect(parseSessionActionRequest({ action: "converge" })).toMatchObject({ ok: true });
});

test("caller-provided timeouts get a margin over the CLI's own budget", () => {
  expect(sessionActionTimeoutMs(parsed({ action: "converge", id: "s", timeoutSeconds: 300 }))).toBe(
    360_000,
  );
  expect(sessionActionTimeoutMs(parsed({ action: "converge", id: "s" }))).toBe(600_000);
});

// --- launcher / envelope validation ------------------------------------------------------------

test("dev host selects its checkout CLI even when an installed shim exists", () => {
  expect(
    peRevitLauncher(
      { lane: "dev", sourceRoot: "C:\\repo\\Pe.Tools\\source\\pe-tools" },
      undefined,
      () => true,
    ),
  ).toEqual({
    cmd: "dotnet",
    args: ["tool", "run", "pe-revit", "--"],
    cwd: join("C:\\repo\\Pe.Tools"),
  });
  expect(() => peRevitLauncher({ lane: "dev", sourceRoot: null }, undefined, () => true)).toThrow(
    "requires devWorkingDirectory",
  );
});

test("session CLI rejects empty, invalid, and non-envelope output", () => {
  const launch = { cmd: "dotnet", args: ["pe-revit"] } as const;
  const args = ["session", "status", "--json"];
  expect(() => validatePeRevitEnvelope("", args, launch)).toThrow("no output");
  expect(() => validatePeRevitEnvelope("not json", args, launch)).toThrow("invalid JSON");
  expect(() => validatePeRevitEnvelope("{}", args, launch)).toThrow("non-envelope");
  // The SDK validator requires the full envelope — a guide-less envelope is exactly the
  // pre-session-CLI output it exists to reject.
  const guideless = '{"result":{},"resolved":{},"diagnostics":[],"nextSteps":[]}';
  expect(() => validatePeRevitEnvelope(guideless, args, launch)).toThrow("non-envelope");
  // The seventh field, `binary`, arrived with the beta.121 envelope and the vendored validator
  // now checks it. A six-field envelope no longer passes — which is the whole point of vendoring
  // the validator instead of restating the shape here.
  const sixField =
    '{"result":{},"resolved":{},"diagnostics":[],"nextSteps":[],"guide":"g","related":[]}';
  expect(() => validatePeRevitEnvelope(sixField, args, launch)).toThrow("non-envelope");
  const envelope =
    '{"result":{},"resolved":{},"diagnostics":[],"nextSteps":[],"guide":"g","related":[],"binary":null}';
  expect(validatePeRevitEnvelope(envelope, args, launch)).toBe(envelope);
});

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

  expect(seen).toEqual([["session", "status", "--json"]]);
  expect(outcome).toEqual({ status: 200, bodyJson: envelope });
});

test("a spawn failure is a plain 500", async () => {
  const outcome = await Effect.runPromise(
    executeSessionCli(
      ["session", "status", "--json"],
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
      ["session", "converge", "--id", "scratch", "--json"],
      () => Effect.never,
      50,
      {
        action: "converge",
        id: "scratch",
      },
    ),
  );

  expect(outcome.status).toBe(504);
  const body = JSON.parse(outcome.bodyJson) as Record<string, unknown>;
  // No `result`/`resolved`/`guide`: this route relays the SDK's envelope and never fabricates
  // one, so a caller can never mistake a route-local timeout for an SDK verdict.
  expect(Object.keys(body).sort()).toEqual(["error", "nextSteps", "ok"]);
  expect(body.ok).toBe(false);
  expect((body.nextSteps as string[])[1]).toContain("pe-revit session stop --id scratch --force");
});
