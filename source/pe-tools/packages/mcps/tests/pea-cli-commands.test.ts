import { cli } from "gunshi";
import { expect, test, vi } from "vite-plus/test";
import type { HostOpResponse } from "@pe/host-contracts/operation-types";
import { PeaCliCommands } from "../src/pea/PeaCliCommands.ts";

const statuses = [
  "Succeeded",
  "RuntimeFailed",
  "CompilationFailed",
  "Canceled",
] satisfies HostOpResponse<"scripting.execute">["status"][];

test("independent import carries the local folder and explicit copy choice through Gunshi", async () => {
  const commands = new PeaCliCommands({ hostBaseUrl: "http://host.test" });
  const scripting = {
    importPod: vi.fn(async () => ({
      status: "Succeeded",
      workspaceKey: "Office Copy",
      diagnostics: [],
      generatedFiles: [],
      importedFiles: [],
    })),
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
    await cli(
      ["import", "--archive", "example.zip", "--workspace", "Office Copy", "--independent"],
      command,
      { subCommands: command.subCommands },
    );
    expect(scripting.importPod).toHaveBeenCalledWith({
      archivePath: "example.zip",
      workspaceKey: "Office Copy",
      independent: true,
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
