import type { MastraTUIOptions } from "mastracode/tui";
import { runRuntimeAcpAgent } from "@pe/runtime";
import { createPeaRuntime, type PeaRuntimeOptions } from "@pe/runtime/pea";

// The runtime defaults closed (no Revit tools unless asserted). The root TUI and ACP are Pea's
// Revit operator surfaces, so they assert Revit like `pea --prompt` and the default host do.
// ponytail: a dev host started with --no-revit is still advertised Revit tools here; read the
// host's capabilities at launch if that dev case ever matters.
const peaOperatorCapabilities = { revit: true } as const;

export async function runPeaTui(options: PeaRuntimeOptions = {}): Promise<void> {
  const runtime = await createPeaRuntime({ capabilities: peaOperatorCapabilities, ...options });
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
  const runtime = await createPeaRuntime({
    capabilities: peaOperatorCapabilities,
    ...options,
    protocol: "acp",
  });
  if (!runtime.session) throw new Error("Expected Pea runtime session.");
  await runRuntimeAcpAgent({
    controller: runtime.controller,
    session: runtime.session,
    modes: runtime.controller.listModes(),
    cleanup: () => runtime.close?.(),
  });
}
