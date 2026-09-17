import { cli } from "gunshi";
import { expect, test, vi } from "vite-plus/test";
import type { HostOpResponse } from "@pe/host-contracts/operation-types";
import { PeaCliCommands } from "../src/pea/PeaCliCommands.ts";
import { ScriptingTools } from "../src/shared/scripting.ts";

const statuses = [
  "Succeeded",
  "RuntimeFailed",
  "CompilationFailed",
  "Canceled",
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
  const call = vi.fn(async () => ({ id: "x", folder: "x" }));
  const tool = new ScriptingTools({ call } as never, { workspaceKey: "default" });
  await tool.importPod({ archivePath: "a.zip" });
  await tool.importPod({ archivePath: "a.zip", folder: "Copy" });
  expect(call.mock.calls).toEqual([
    ["pod.import", { archivePath: "a.zip" }],
    ["pod.import", { archivePath: "a.zip", folder: "Copy" }],
  ]);
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
