import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  claudeInit,
  claudeSessionMeta,
  harnessManifest,
  undeclaredContext,
} from "../src/harness/manifest.ts";
import { writePeaCodexProjectConfig } from "../src/harness/user-shell.ts";

test("the Claude projection closes every account door and keeps the shell and file tools", () => {
  const { options, emitRawSDKMessages } = claudeSessionMeta().claudeCode;
  expect(options.strictMcpConfig).toBe(true);
  expect(options.settingSources).toEqual(["project", "local"]);
  expect(options.settings).toMatchObject({
    disableClaudeAiConnectors: true,
    attribution: { commit: "", pr: "" },
  });
  expect(options.env).toMatchObject({
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_DISABLE_CRON: "1",
  });
  for (const tool of ["Bash", "PowerShell", "Read", "Glob", "Grep", "Edit", "Write", "Skill"])
    expect(options.tools).toContain(tool);
  for (const tool of ["WebFetch", "WebSearch", "ToolSearch", "Agent", "TodoWrite"])
    expect(options.tools).toContain(tool);
  for (const cut of [
    "CronCreate",
    "EnterWorktree",
    "PushNotification",
    "RemoteTrigger",
    "DesignSync",
  ])
    expect(options.tools).not.toContain(cut);
  expect(emitRawSDKMessages).toEqual([{ type: "system", subtype: "init" }]);
});

test("a child with only declared servers and tools matches the manifest", () => {
  expect(
    undeclaredContext({
      tools: ["Bash", "Read", "mcp__pea__pe_find"],
      mcp_servers: [{ name: "pea", status: "connected" }],
    }),
  ).toBeNull();
});

test("an undeclared server, built-in or MCP tool refuses, naming each", () => {
  const refusal = undeclaredContext({
    tools: ["Bash", "CronCreate", "mcp__claude_ai_Gmail__send_message", "mcp__pea__pe_do"],
    mcp_servers: [
      { name: "pea", status: "connected" },
      { name: "claude.ai Gmail", status: "connected" },
    ],
  });
  expect(refusal).toContain("claude.ai Gmail");
  expect(refusal).toContain("CronCreate");
  expect(refusal).toContain("mcp__claude_ai_Gmail__send_message");
  expect(refusal).not.toContain("mcp__pea__pe_do");
});

test("only the SDK init frame counts as the child's report", () => {
  const init = { type: "system", subtype: "init", tools: [] };
  expect(claudeInit("_claude/sdkMessage", { message: init })).toBe(init);
  expect(claudeInit("_claude/sdkMessage", { message: { type: "assistant" } })).toBeNull();
  expect(claudeInit("_other", { message: init })).toBeNull();
});

test("the Codex project config switches the manifest's account features off and the user's servers by name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-manifest-"));
  try {
    await writePeaCodexProjectConfig(dir, ["gmail"]);
    const config = await readFile(join(dir, ".codex", "config.toml"), "utf8");
    for (const feature of harnessManifest.codex.features)
      expect(config).toContain(`${feature} = false`);
    expect(config).toContain('[mcp_servers."gmail"]\nenabled = false');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
