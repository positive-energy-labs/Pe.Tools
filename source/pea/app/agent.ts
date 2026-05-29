import { MastraTUI } from "mastracode/tui";
import { createPeaRuntime, type PeAgentOptions } from "./pea-runtime.js";

export type { PeAgentOptions } from "./pea-runtime.js";

export async function runPeAgent(options: PeAgentOptions = {}): Promise<void> {
  const runtime = await createPeaRuntime(options);
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
