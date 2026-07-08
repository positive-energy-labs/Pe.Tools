import type { MastraTUIOptions } from "mastracode/tui";
import { runRuntimeAcpAgent } from "@pe/runtime";
import { createPeaRuntime, createPeaTuiRuntime, type PeaTuiRuntimeOptions } from "@pe/runtime/pea";

// Runtime construction now lives in `@pe/runtime` (the `@pe/runtime/pea` subpath) so the
// host can consume it as a library. This module re-exports that surface and keeps the pea
// process entrypoints (TUI + ACP) as thin wrappers.
export {
  createPeaRuntime,
  createPeaTuiRuntime,
  createPeaRuntimeAuthProfile,
  defaultPeaRuntimeToolCatalog,
  defaultPeaRuntimeToolProfile,
  peaRuntimeToolProfile,
} from "@pe/runtime/pea";
export type {
  PeaRuntimeAuthSource,
  PeaRuntimeHandle,
  PeaRuntimeServices,
  PeaTuiRuntimeOptions,
} from "@pe/runtime/pea";

export async function runPeaTui(options: PeaTuiRuntimeOptions = {}): Promise<void> {
  const runtime = await createPeaTuiRuntime(options);
  if (!runtime.session) throw new Error("Expected Pea runtime session.");
  const { MastraTUI } = await import("mastracode/tui");
  const tuiOptions: MastraTUIOptions = {
    controller: runtime.controller,
    session: runtime.session,
    authStorage: runtime.authStorage,
    hookManager: runtime.hookManager,
    mcpManager: runtime.mcpManager,
    appName: "Pea",
    version: "0.1.0",
  };
  const tui = new MastraTUI(tuiOptions);
  await tui.run();
}

export async function runPeaAcp(options: PeaTuiRuntimeOptions = {}): Promise<void> {
  const runtime = await createPeaRuntime({ ...options, protocol: "acp" });
  if (!runtime.session) throw new Error("Expected Pea runtime session.");
  await runRuntimeAcpAgent({
    controller: runtime.controller,
    session: runtime.session,
    modes: runtime.controller.listModes(),
    cleanup: () => runtime.close?.(),
  });
}
