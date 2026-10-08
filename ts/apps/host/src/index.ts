import "./ensure-source-lane.ts"; // MUST be first: sets PE_LANE=dev for source runs before load

// `Pe.Host.exe --adapter claude|codex`: the installed host is also its own ACP adapter process, so no
// second Node ships (harness/adapter.ts adapterLaunch). None of the host loads in that mode.
const adapter = process.argv.indexOf("--adapter");
if (adapter < 0) void import("./host-main.ts");
else {
  const [, harness] = process.argv.splice(adapter, 2);
  if (harness === "claude") void import("@agentclientprotocol/claude-agent-acp/dist/index.js");
  // @ts-expect-error codex-acp ships one bundled bin with no type declarations
  else if (harness === "codex") void import("@agentclientprotocol/codex-acp/dist/index.js");
  else throw new Error(`--adapter takes claude or codex, got ${harness}`);
}
