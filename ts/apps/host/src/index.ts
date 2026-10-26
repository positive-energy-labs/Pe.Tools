import "./ensure-source-lane.ts"; // MUST be first: sets PE_LANE=dev for source runs before load
import { dispatchBrowserWorker } from "@pe/browser/worker";
import { writeFatalEvidence } from "../../../packages/runtime/src/analytics.ts";

// `Pe.Host.exe --adapter claude|codex`: the installed host is also its own ACP adapter process, so no
// second Node ships (harness/adapter.ts adapterLaunch). None of the host loads in that mode.
const adapter = process.argv.indexOf("--adapter");
if (await dispatchBrowserWorker()) {
  // Browser keeper mode must never load host or ACP startup.
} else if (adapter < 0)
  void import("./host-main.ts").catch((error) => {
    writeFatalEvidence("process.unhandled-rejection", error);
    process.exit(1);
  });
else {
  const [, harness] = process.argv.splice(adapter, 2);
  if (harness === "claude") void import("@agentclientprotocol/claude-agent-acp/dist/index.js");
  // @ts-expect-error codex-acp ships one bundled bin with no type declarations
  else if (harness === "codex") void import("@agentclientprotocol/codex-acp/dist/index.js");
  else throw new Error(`--adapter takes claude or codex, got ${harness}`);
}
