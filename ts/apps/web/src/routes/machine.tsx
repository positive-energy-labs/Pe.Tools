import { createFileRoute } from "@tanstack/react-router";

import { MachinePage } from "#/machine/page";
import { useMachine } from "#/machine/use-machine";

/**
 * The tray window's page (host ledger 2026-10-09 ruling 4): the WebView2 shim navigates here with
 * `?shell=tray` and the service token. No app chrome, the machine body alone; Open window
 * and Quit host sit in its footer. Without `shell=tray` the same body is a typed-URL view.
 */
export const Route = createFileRoute("/machine")({
  validateSearch: (search: Record<string, unknown>) => ({
    shell: search.shell === "tray" ? ("tray" as const) : undefined,
  }),
  component: MachineRoute,
});

function MachineRoute() {
  const { shell } = Route.useSearch();
  const { reading, fixture } = useMachine();
  return <MachinePage reading={reading} fixture={fixture} shell={shell ?? "drawer"} />;
}
