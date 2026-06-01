import { createPeaRuntime, type PeaAgentOptions } from "./pea-runtime.js";

export type { PeaAgentOptions } from "./pea-runtime.js";

export async function runPeAgent(options: PeaAgentOptions = {}): Promise<void> {
  const runtime = await createPeaRuntime(options);
  const { MastraTUI } = await import("mastracode/tui");
  const tui = new MastraTUI({
    harness: runtime.harness,
    hookManager: runtime.hookManager,
    authStorage: runtime.authStorage,
    mcpManager: runtime.mcpManager,
    appName: "Pea (Positive Energy Agent)",
    version: "0.5.0",
  });

  tui.run();
}
