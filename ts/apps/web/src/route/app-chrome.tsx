/**
 * Machine attention and feedback exist once around every surface's route outlet.
 * Their doors are projections in the shared topbar, not separate floating controls.
 * On the tray surface the receipt notice card mounts here too, whatever route the panel shows.
 */
import { FeedbackPicker } from "#/components/feedback-picker";
import { MachineAttention } from "#/machine/attention";
import { NoticeCard } from "#/machine/notice";
import { useMachine } from "#/machine/use-machine";
import { useSurfaceHost } from "#/navigation/surface-host";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { OwnerInspector } from "#/state/owner-inspector";

export function AppChrome() {
  return (
    <>
      <MachineAttention />
      <TrayNotice />
      <FeedbackPicker hideTrigger />
    </>
  );
}

function TrayNotice() {
  const { reading, fixture } = useMachine();
  return useSurfaceHost().surface === "tray" ? (
    <NoticeCard reading={reading} fixture={fixture} />
  ) : null;
}

export function AppDevtools({ pathname, shell }: { pathname: string; shell?: string }) {
  if (pathname === "/open" || shell === "tray") return null;
  return (
    <TanStackDevtools
      // The bottom corners belong to the product's own chrome (feedback left, machine chip right);
      // the dev-only trigger waits, fixed and hidden until hover, on the right edge's middle.
      config={{ position: "middle-right", triggerMode: "fixed", hideUntilHover: true }}
      plugins={[
        { name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> },
        { name: "Route owners", render: <OwnerInspector /> },
      ]}
    />
  );
}
