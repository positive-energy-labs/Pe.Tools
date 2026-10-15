import { normalizePeError } from "@pe/host-contracts/pe-api";
import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
import { cli } from "gunshi";
import { expect, test, vi } from "vite-plus/test";
import type { HostOpResponse } from "@pe/host-contracts/operation-types";
import { documentRows, recentRows } from "@pe/agent-contracts";
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
      admitCrossing(identity.caller, body.destination, "/actions");
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

const statuses = [
  "Succeeded",
  "RuntimeFailed",
  "CompilationFailed",
  "Cancelled",
] satisfies HostOpResponse<"scripting.execute">["status"][];

test("import carries the optional local folder through Gunshi to pod.import", async () => {
  const commands = new PeaCliCommands({ hostBaseUrl: "http://host.test" });
  const scripting = {
    importPod: vi.fn(async () => ({ id: "pe-standards", folder: "Office Copy" })),
  };
  const tools = vi
    .spyOn(
      commands as unknown as { createScriptingTools: () => typeof scripting },
      "createScriptingTools",
    )
    .mockReturnValue(scripting);
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const command = commands.scriptCommand();
    const run = (args: string[]) => cli(args, command, { subCommands: command.subCommands });
    await run(["import", "--archive", "example.zip", "--folder", "Office Copy"]);
    expect(scripting.importPod).toHaveBeenLastCalledWith({
      archivePath: "example.zip",
      folder: "Office Copy",
    });
    expect(output).toHaveBeenCalledWith("folder Office Copy");
    await run(["import", "--archive", "example.zip"]);
    expect(scripting.importPod).toHaveBeenLastCalledWith({
      archivePath: "example.zip",
      folder: undefined,
    });
  } finally {
    output.mockRestore();
    tools.mockRestore();
  }
});

test.each(statuses)("pea script execute maps %s to the process exit code", async (status) => {
  const originalExitCode = process.exitCode;
  const commands = new PeaCliCommands({ hostBaseUrl: "http://host.test" });
  const scripting = {
    execute: vi.fn(async () => ({
      status,
      executionId: "execution-1",
      diagnostics: [],
      output: "",
      revitVersion: "2025",
      targetFramework: "net8.0-windows",
    })),
  };
  const tools = vi
    .spyOn(
      commands as unknown as {
        createScriptingTools: () => typeof scripting;
      },
      "createScriptingTools",
    )
    .mockReturnValue(scripting);
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    process.exitCode = 0;
    const command = commands.scriptCommand();
    await cli(["execute", "--script-content", "WriteLine(1);"], command, {
      subCommands: command.subCommands,
    });

    expect(process.exitCode).toBe(status === "Succeeded" ? 0 : 1);
  } finally {
    process.exitCode = originalExitCode;
    output.mockRestore();
    tools.mockRestore();
  }
});

test("pea script execute --json prints the whole result as one JSON object", async () => {
  const originalExitCode = process.exitCode;
  const commands = new PeaCliCommands({ hostBaseUrl: "http://host.test" });
  const result = {
    status: "RuntimeFailed" as const,
    executionId: "execution-1",
    diagnostics: [
      { stage: "resolve", severity: "Info" as const, message: "resolved 3 references" },
      { stage: "runtime", severity: "Warning" as const, message: "one duct had no level" },
    ],
    output: "hello\n",
    revitVersion: "2025",
    targetFramework: "net8.0-windows",
    data: { ducts: [1, 2] },
  };
  const scripting = { execute: vi.fn(async () => result) };
  const tools = vi
    .spyOn(
      commands as unknown as { createScriptingTools: () => typeof scripting },
      "createScriptingTools",
    )
    .mockReturnValue(scripting);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    process.exitCode = 0;
    const command = commands.scriptCommand();
    await cli(["execute", "--script-content", "WriteLine(1);", "--json"], command, {
      subCommands: command.subCommands,
    });

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdout.mock.calls[0]![0]))).toEqual(result);
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = originalExitCode;
    stdout.mockRestore();
    error.mockRestore();
    log.mockRestore();
    tools.mockRestore();
  }
});

test("pea find prints key, kind and title per row of the host's catalog; --mention prints the pointer", async () => {
  const at = "2026-10-12T12:00:00.000Z";
  const machine = machineFixture([
    {
      session: "b1",
      documents: [
        {
          openId: "o1",
          address: "C:\\Models\\Riser.rvt",
          title: "Mechanical Riser",
          isFamilyDocument: false,
          isActive: true,
        },
      ],
    },
  ]);
  const skill = {
    key: "skill:@skills/skills/riser-check",
    kind: "skill",
    title: "riser-check",
    description: "Check a riser.",
    needs: "nothing",
    mutates: false,
    principal: ["human", "pea", "page", "external-mcp"],
    input: {},
    source: "skills",
    package: { id: "skills", path: "skills/riser-check/SKILL.md", sha256: "a".repeat(64) },
    rank: 0,
  } as const;
  // A human-only press: pe_find never offers it, so neither does pea find.
  const humanOnly = {
    ...skill,
    key: "route:riser.apply",
    kind: "route-command",
    title: "Riser: apply",
    principal: ["human"],
    package: undefined,
  } as const;
  const recents = [
    {
      title: "Plant",
      path: "C:\\Jobs\\Plant.rvt",
      isCloud: false,
      region: null,
      projectGuid: null,
      modelGuid: null,
      year: 2025,
      savedYear: 2025,
      rank: 1,
    },
  ];
  const host = fakeRuntimeHost("http://127.0.0.1:9");
  const urls: URL[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    urls.push(new URL(input instanceof Request ? input.url : String(input)));
    return Response.json({
      at,
      machine,
      recents,
      sources: {},
      diagnostics: [],
      capabilities: [
        skill,
        humanOnly,
        ...documentRows({ machine }),
        ...recentRows({ machine, recents }),
      ],
    });
  });
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const disclosed = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const command = new PeaCliCommands({ hostBaseUrl: host }).findCommand();
    await cli(["riser"], command);
    expect(urls[0]?.pathname).toBe("/pe/capabilities");
    expect(disclosed).toHaveBeenCalledWith(`host ${host}`);
    // findCapabilities' ranking: the skill's key, title and description all say riser.
    expect(output.mock.calls.map(([line]) => line)).toEqual([
      "skill:@skills/skills/riser-check  skill  riser-check",
      "doc:b1/o1  document  Mechanical Riser",
    ]);
    output.mockClear();
    await cli(["--kind", "document", "--json"], command);
    expect(JSON.parse(output.mock.calls[0]![0] as string)).toMatchObject([
      { key: "doc:b1/o1", kind: "document" },
    ]);
    output.mockClear();
    await cli(["--mention", "doc:b1/o1"], command);
    expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual({
      key: "doc:b1/o1",
      kind: "document",
      title: "Mechanical Riser",
      takenAt: at,
      facts: {
        session: "b1",
        openId: "o1",
        address: "C:\\Models\\Riser.rvt",
        family: false,
        active: true,
        revit: "2025",
        custody: "controlled",
      },
    });
    // Revit's recent documents are rows too; the mention carries the source that opens them.
    output.mockClear();
    await cli(["--kind", "recent", "plant"], command);
    expect(output.mock.calls.map(([line]) => line)).toEqual([
      "recent:C:\\Jobs\\Plant.rvt  recent  Plant",
    ]);
    output.mockClear();
    await cli(["--mention", "recent:C:\\Jobs\\Plant.rvt"], command);
    expect(JSON.parse(output.mock.calls[0]![0] as string).facts).toMatchObject({
      year: 2025,
      open: null,
      openWith: "C:\\Jobs\\Plant.rvt",
    });
  } finally {
    output.mockRestore();
    disclosed.mockRestore();
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
  ...[
    "ReferenceResolutionFailed",
    "CompilationFailed",
    "RuntimeFailed",
    "Rejected",
    "PolicyRejected",
    "Cancelled",
    "TimedOut",
  ].map((status) => ({ json: true, status, count: 1 })),
  { json: false, status: "PolicyRejected", count: 1 },
  { json: true, status: "PolicyRejected", count: 65 },
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
    native.diagnostics = Array.from({ length: count }, () => native.diagnostics[0]!);
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
        kind: admission.kind,
        id: admission.id,
        key: admission.key,
        caller: { kind: "anonymous" },
        basis: null,
        destination: admission.destination,
        request: admission.input,
        bases: admission.bases,
        steps: [],
        preparation: { state: "ready", value: { sourceBundle: "MUST NOT PRINT" } },
        recovery: [],
        startedAt: "2026-10-15T00:00:00Z",
        publication: { state: "unrequested" },
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
          evidence: { result: { ...native, diagnostics: native.diagnostics.slice(0, 64) } },
        });
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

test("script --json emits a structured input failure without dispatch", async () => {
  const originalExitCode = process.exitCode;
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const command = new PeaCliCommands().scriptCommand();
  try {
    process.exitCode = 0;
    await cli(["execute", "--json"], command, { subCommands: command.subCommands });
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdout.mock.calls[0]![0]))).toEqual({
      error: "Provide --file, --stdin, --script-content, or --source-path.",
    });
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = originalExitCode;
    stdout.mockRestore();
  }
});
