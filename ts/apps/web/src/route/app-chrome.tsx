/**
 * What every page wears outside its route: the version chip (the machine drawer's door) and the
 * feedback picker. The tray window (`/machine`) wears neither; it is the machine body alone.
 */
import { FeedbackPicker } from "#/components/feedback-picker";
import { VersionChip } from "#/machine/drawer";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { OwnerInspector } from "#/state/owner-inspector";

export function AppChrome({ pathname }: { pathname: string }) {
  if (pathname === "/machine") return null;
  return (
    <>
      <VersionChip />
      <FeedbackPicker />
    </>
  );
}

export function AppDevtools({ pathname, shell }: { pathname: string; shell?: string }) {
  if (pathname === "/open" || (pathname === "/machine" && shell === "tray")) return null;
  return (
    <TanStackDevtools
      config={{ position: "middle-left" }}
      plugins={[
        { name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> },
        { name: "Route owners", render: <OwnerInspector /> },
      ]}
    />
  );
}
