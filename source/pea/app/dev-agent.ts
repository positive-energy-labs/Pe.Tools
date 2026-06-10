import { createPeCodeRuntime, type DevAgentOptions } from "./pe-code-runtime.js";

export type { DevAgentOptions } from "./pe-code-runtime.js";

export async function runDevAgent(options: DevAgentOptions = {}): Promise<void> {
  const runtime = await createPeCodeRuntime(options);
  const { MastraTUI } = await import("mastracode/tui");
  const tui = new MastraTUI({
    harness: runtime.harness,
    hookManager: runtime.hookManager,
    authStorage: runtime.authStorage,
    mcpManager: runtime.mcpManager,
    appName: "dev-agent (Pe.Tools)",
    version: "0.1.0",
  });

  tui.run();
}
