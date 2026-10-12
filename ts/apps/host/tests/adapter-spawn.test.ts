import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test } from "vite-plus/test";

const require = createRequire(import.meta.url);
async function dependencySource(pkg: string, file: string) {
  return readFile(join(dirname(require.resolve(`${pkg}/package.json`)), file), "utf8");
}

// Check the dependency bytes consumed by source adapters and the installed host bundle.
// Native console visibility is a separate installed proof using the Windows event hook.
test("Claude ACP auth probes and logout hide their own console children", async () => {
  const source = await dependencySource(
    "@agentclientprotocol/claude-agent-acp",
    "dist/acp-agent.js",
  );
  const status = source.match(
    /execFileAsync\(cliPath, \["auth", "status", "--json"\], (\{[^}]+\})/,
  );
  const logout = source.match(/execFileAsync\(cliPath, \["auth", "logout"\](?:, (\{[^}]+\}))?/);
  expect(status?.[1]).toContain("windowsHide: true");
  expect(logout?.[1]).toContain("windowsHide: true");
});

test("Codex ACP app-server launches hide shell and direct console children", async () => {
  const source = await dependencySource("@agentclientprotocol/codex-acp", "dist/index.js");
  const connection = source.slice(source.indexOf("function startCodexConnection("));
  const launches = connection
    .slice(0, connection.indexOf("attachLogs(codex)"))
    .match(/spawn\([^;]+/g);
  expect(launches).toHaveLength(2);
  expect(launches?.join("\n").match(/windowsHide: true/g)).toHaveLength(3);
});
