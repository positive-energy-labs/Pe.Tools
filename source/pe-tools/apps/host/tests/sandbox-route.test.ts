import { Effect } from "effect";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  executeSandboxCli,
  parseSandboxActionRequest,
  resolveSandboxStartPayloadArgs,
  sandboxActionTimeoutMs,
  sandboxCliArgs,
  sandboxStatusArgs,
  unresponsiveSandboxEnvelope,
  type SandboxActionRequest,
} from "../src/sandbox-route.ts";

function parsed(body: unknown): SandboxActionRequest {
  const result = parseSandboxActionRequest(body);
  if (!result.ok) throw new Error(result.error);
  return result.request;
}

// --- action → CLI args mapping ----------------------------------------------------------------

test("start on a source-linked (dev) host uses the checkout's Pe.App project", () => {
  const payload = resolveSandboxStartPayloadArgs("dev", "C:\\repo\\Pe.Tools\\source\\pe-tools");
  expect(payload).toEqual([
    "--project",
    join("C:\\repo\\Pe.Tools", "source", "Pe.App", "Pe.App.csproj"),
  ]);

  const args = sandboxCliArgs(parsed({ action: "start", year: 25, id: "scratch", wait: true }), payload);
  expect(args).toEqual([
    "sandbox",
    "start",
    "--project",
    join("C:\\repo\\Pe.Tools", "source", "Pe.App", "Pe.App.csproj"),
    "--year",
    "25",
    "--id",
    "scratch",
    "--wait",
    "--json",
  ]);
});

test("start on an installed-lane host uses the shipped Pe.App payload", () => {
  expect(resolveSandboxStartPayloadArgs("installed", null)).toEqual(["--installed", "Pe.App"]);
  // A dev host with no resolvable source root also falls back to the shipped payload.
  expect(resolveSandboxStartPayloadArgs("dev", null)).toEqual(["--installed", "Pe.App"]);

  const args = sandboxCliArgs(parsed({ action: "start", year: "25" }), ["--installed", "Pe.App"]);
  expect(args).toEqual(["sandbox", "start", "--installed", "Pe.App", "--year", "25", "--json"]);
});

test("wait/restart/stop map to --id verbs; stop honors force; timeouts skip stop", () => {
  const payload = ["--installed", "Pe.App"];
  expect(sandboxCliArgs(parsed({ action: "wait", id: "scratch", timeoutSeconds: 300 }), payload)).toEqual([
    "sandbox",
    "wait",
    "--id",
    "scratch",
    "--timeout-seconds",
    "300",
    "--json",
  ]);
  expect(sandboxCliArgs(parsed({ action: "restart", id: "scratch" }), payload)).toEqual([
    "sandbox",
    "restart",
    "--id",
    "scratch",
    "--json",
  ]);
  expect(
    sandboxCliArgs(parsed({ action: "stop", id: "scratch", force: true, timeoutSeconds: 60 }), payload),
  ).toEqual(["sandbox", "stop", "--id", "scratch", "--force", "--json"]);
});

test("status args pass an optional id filter", () => {
  expect(sandboxStatusArgs()).toEqual(["sandbox", "status", "--json"]);
  expect(sandboxStatusArgs("scratch")).toEqual(["sandbox", "status", "--id", "scratch", "--json"]);
});

test("action body validation mirrors the CLI invocation contract", () => {
  expect(parseSandboxActionRequest(null)).toMatchObject({ ok: false });
  expect(parseSandboxActionRequest({ action: "destroy" })).toMatchObject({ ok: false });
  expect(parseSandboxActionRequest({ action: "start" })).toMatchObject({ ok: false }); // no year
  expect(parseSandboxActionRequest({ action: "stop" })).toMatchObject({ ok: false }); // no id
  expect(parseSandboxActionRequest({ action: "start", year: 25 })).toMatchObject({ ok: true });
});

test("caller-provided timeouts get a margin over the CLI's own budget", () => {
  expect(sandboxActionTimeoutMs(parsed({ action: "wait", id: "s", timeoutSeconds: 300 }))).toBe(360_000);
  expect(sandboxActionTimeoutMs(parsed({ action: "wait", id: "s" }))).toBe(600_000);
});

// --- shelled execution (fake shell layer, no real CLI) ----------------------------------------

test("CLI stdout (the JSON envelope) relays verbatim, even for failed verdicts", async () => {
  const envelope = '{"result":{"sandboxes":[]},"diagnostics":[]}';
  const seen: string[][] = [];
  const outcome = await Effect.runPromise(
    executeSandboxCli(
      sandboxStatusArgs(),
      (args) => {
        seen.push([...args]);
        return Effect.succeed(envelope);
      },
      1_000,
      { action: "status" },
    ),
  );

  expect(seen).toEqual([["sandbox", "status", "--json"]]);
  expect(outcome).toEqual({ status: 200, bodyJson: envelope });
});

test("a spawn failure is a plain 500", async () => {
  const outcome = await Effect.runPromise(
    executeSandboxCli(["sandbox", "status", "--json"], () => Effect.fail("pe-revit not found"), 1_000, {
      action: "status",
    }),
  );

  expect(outcome.status).toBe(500);
  expect(JSON.parse(outcome.bodyJson)).toMatchObject({ ok: false, error: "pe-revit not found" });
});

test("a hung CLI surfaces state=unresponsive pointing at pe_sandbox action=stop", async () => {
  const outcome = await Effect.runPromise(
    executeSandboxCli(["sandbox", "wait", "--id", "scratch", "--json"], () => Effect.never, 50, {
      action: "wait",
      id: "scratch",
    }),
  );

  expect(outcome.status).toBe(200);
  const body = JSON.parse(outcome.bodyJson) as {
    result: { id: string | null; state: string };
    nextSteps: string[];
  };
  expect(body.result).toEqual({ id: "scratch", state: "unresponsive" });
  expect(body.nextSteps[0]).toContain("pe_sandbox action=stop id=scratch");
});

test("unresponsive envelope keeps the Phase 5 envelope shape", () => {
  const envelope = unresponsiveSandboxEnvelope("start", undefined, 600_000);
  expect(Object.keys(envelope).sort()).toEqual([
    "diagnostics",
    "guide",
    "nextSteps",
    "related",
    "resolved",
    "result",
  ]);
  expect(envelope.guide).toBe("sandbox");
});
