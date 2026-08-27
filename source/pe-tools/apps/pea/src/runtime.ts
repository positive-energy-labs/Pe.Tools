import type { MastraTUIOptions } from "mastracode/tui";
import { runRuntimeAcpAgent } from "@pe/runtime";
import { createPeaRuntime, type PeaRuntimeOptions } from "@pe/runtime/pea";

export async function runPeaTui(options: PeaRuntimeOptions = {}): Promise<void> {
  const runtime = await createPeaRuntime(options);
  if (!runtime.session) throw new Error("Expected Pea runtime session.");
  const { MastraTUI } = await import("mastracode/tui");
  const tuiOptions: MastraTUIOptions = {
    controller: runtime.controller,
    session: runtime.session,
    authStorage: runtime.authStorage,
    appName: "Pea",
    version: "0.1.0",
  };
  const tui = new MastraTUI(tuiOptions);
  await tui.run();
}

export async function runPeaAcp(options: PeaRuntimeOptions = {}): Promise<void> {
  const runtime = await createPeaRuntime({ ...options, protocol: "acp" });
  if (!runtime.session) throw new Error("Expected Pea runtime session.");
  await runRuntimeAcpAgent({
    controller: runtime.controller,
    session: runtime.session,
    modes: runtime.controller.listModes(),
    cleanup: () => runtime.close?.(),
  });
}
