import { normalizePeError } from "@pe/host-contracts/pe-api";
import { cli } from "gunshi";
import { expect, test, vi } from "vite-plus/test";
import { PeaCliCommands } from "../src/pea/PeaCliCommands.ts";
import { fakeRuntimeHost } from "./runtime-host-fixture.ts";
import { admitCrossing, callerOf, Refused } from "../../../apps/host/src/control.ts";

test("CLI has no actor flag; no-context host and script writes get context.missing", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubEnv("PE_CONTEXT", "");
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/ops")
      return Response.json({
        bridgeSessionId: "you",
        operations: [{ key: "scripting.execute", intent: "Mutate", needs: "document" }],
      });
    expect(url.pathname).toBe("/actions");
    const body = JSON.parse(await new Response(init?.body).text());
    posts.push(body);
    expect(body).not.toHaveProperty("actor");
    const identity = callerOf({ kind: "local" }, Object.fromEntries(new Headers(init?.headers)));
    if ("refusal" in identity) throw Error(identity.refusal.detail);
    try {
      admitCrossing(identity.caller, body.target, "/actions");
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return normalizePeError(
        Response.json(
          { error: error.message, refusal: error.refusal, notDispatched: true },
          { status: 403 },
        ),
      );
    }
    throw Error("Anonymous write was admitted");
  });
  const commands = new PeaCliCommands({ hostBaseUrl: "http://127.0.0.1:9" });
  const host = commands.hostCommand();
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const disclosure = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const invoke = (args: string[]) => cli(args, host, { subCommands: host.subCommands });
    const call = host.subCommands.call;
    expect(call.args).not.toHaveProperty("actor");
    await expect(
      invoke([
        "call",
        "--key",
        "scripting.execute",
        "--bridge-session-id",
        "you",
        "--open-document-id",
        "a",
      ]),
    ).rejects.toMatchObject({ refusal: { code: "context.missing" } });
    const script = commands.scriptCommand();
    expect(script.subCommands.execute.args).not.toHaveProperty("actor");
    await expect(
      cli(
        [
          "execute",
          "--script-content",
          "WriteLine(1);",
          "--bridge-session-id",
          "you",
          "--open-document-id",
          "a",
        ],
        script,
        { subCommands: script.subCommands },
      ),
    ).rejects.toMatchObject({ refusal: { code: "context.missing" } });
    expect(posts).toHaveLength(2);
  } finally {
    output.mockRestore();
    disclosure.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("pea host call reaches a declared HTTP route through the principal-carrying client", async () => {
  const base = fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubEnv("PE_CONTEXT", "cli-context");
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("x-pe-context")).toBe("cli-context");
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetch);
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const host = new PeaCliCommands({ hostBaseUrl: base }).hostCommand();
    await cli(["call", "--key", "http:threads.list"], host, { subCommands: host.subCommands });
    expect(fetch.mock.calls[0]?.[0]).toBe(`${base}/pe/threads`);
    expect(output).toHaveBeenCalledWith("[]");
    await expect(
      cli(["call", "--key", "http:missing"], host, { subCommands: host.subCommands }),
    ).rejects.toThrow("Unknown declared route");
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    output.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test.each([
  { json: false, status: "PolicyRejected", count: 1 },
  { json: true, status: "PolicyRejected", count: 69 },
])(
  "script CLI retains dispatched diagnostics ($status, json=$json)",
  async ({ json, status, count }) => {
    const originalExitCode = process.exitCode;
    const base = fakeRuntimeHost("http://127.0.0.1:19998");
    const native = {
      status,
      executionId: "5f894ab15210479c8202297e93ac7c8a",
      diagnostics: [
        {
          stage: "policy",
          severity: "Error",
          source: "TargetRepair.cs",
          message:
            "WriteTransaction scripts may not create their own Revit transactions; the host owns the transaction.",
        },
      ],
    };
    const policyError = native.diagnostics[0]!;
    native.diagnostics =
      count === 66
        ? [
            ...Array.from({ length: 65 }, (_, i) => ({
              stage: "resolve",
              severity: "Info",
              source: "references",
              message: `reference ${i}`,
            })),
            policyError,
          ]
        : Array.from({ length: count }, () => policyError);
    if (count === 69)
      native.diagnostics = [
        ...Array.from({ length: 65 }, (_, i) => ({
          stage: "resolve",
          severity: "Info",
          source: "references",
          message: `reference ${i}`,
        })),
        { ...policyError, severity: "Warning", message: "first warning" },
        policyError,
        { ...policyError, severity: "Warning", message: "second warning" },
        { ...policyError, message: "second error" },
      ];
    const calls: string[] = [];
    let actionId: string | undefined;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      calls.push(url.pathname);
      if (url.pathname === "/ops")
        return Response.json({
          bridgeSessionId: "fixture-session",
          operations: [{ key: "scripting.execute", intent: "Mutate", needs: "document" }],
        });
      expect(url.pathname).toBe("/actions");
      const admission = JSON.parse(await new Response(init?.body).text());
      actionId = admission.id;
      return Response.json({
        id: admission.id,
        key: admission.key,
        caller: { kind: "anonymous" },
        basis: null,
        target: admission.target,
        input: admission.input,
        steps: [],
        prepared: { state: "ready", value: { sourceBundle: "MUST NOT PRINT" } },
        recovery: [],
        startedAt: "2026-10-15T00:00:00Z",
        state: "failed",
        status: 422,
        error: `Script execution ${status}`,
        evidence: {
          result: {
            ...native,
            data: { assembly: "MUST NOT PRINT" },
            sourceBundle: "MUST NOT PRINT",
          },
        },
      });
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const command = new PeaCliCommands({ hostBaseUrl: base }).scriptCommand();
    try {
      process.exitCode = 0;
      const invoke = () =>
        cli(
          [
            "execute",
            "--script-content",
            "using var tx = new Transaction(doc);",
            "--permission-mode",
            "WriteTransaction",
            "--bridge-session-id",
            "fixture-session",
            "--open-document-id",
            "fixture-open",
            ...(json ? ["--json"] : []),
          ],
          command,
          { subCommands: command.subCommands },
        );
      if (json) {
        await invoke();
        expect(stdout).toHaveBeenCalledTimes(1);
        const outcome = JSON.parse(String(stdout.mock.calls[0]![0]));
        expect(outcome).toMatchObject({
          actionId,
          state: "failed",
          status: 422,
          evidence: {
            result: {
              ...native,
              diagnostics:
                count === 69
                  ? [
                      native.diagnostics[66],
                      native.diagnostics[68],
                      native.diagnostics[65],
                      native.diagnostics[67],
                      ...native.diagnostics.slice(0, 60),
                    ]
                  : count === 66
                    ? [policyError, ...native.diagnostics.slice(0, 63)]
                    : native.diagnostics.slice(0, 64),
            },
          },
        });
        if (count === 66) expect(outcome.evidence.result.diagnostics[0]).toEqual(policyError);
        if (count > 64)
          expect(outcome.evidence.result).toMatchObject({
            diagnosticsTotal: count,
            diagnosticsTruncated: true,
          });
        else expect(outcome.evidence.result).not.toHaveProperty("diagnosticsTruncated");
        expect(outcome.error).toContain(`Script execution ${status}`);
        expect(outcome).not.toHaveProperty("request");
        expect(JSON.stringify(outcome)).not.toContain("MUST NOT PRINT");
        expect(process.exitCode).toBe(1);
      } else {
        await expect(invoke()).rejects.toThrow(/: failed: Script execution PolicyRejected/);
        expect(stdout).not.toHaveBeenCalled();
      }
      expect(calls.filter((path) => path === "/actions")).toHaveLength(1);
      expect(calls).not.toContain("/call");
    } finally {
      process.exitCode = originalExitCode;
      stdout.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  },
);
