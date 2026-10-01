import { cli } from "gunshi";
import { expect, test, vi } from "vite-plus/test";
import type { HostOpResponse } from "@pe/host-contracts/operation-types";
import { PeaCliCommands } from "../src/pea/PeaCliCommands.ts";

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
