/**
 * Machine attention, feedback and the help chord exist once around every surface's route outlet.
 * Their doors are projections in the shared topbar, not separate floating controls.
 * The receipt card has its own shell. A web surface with no tray following can raise OS notifications.
 */
import { useRouterState } from "@tanstack/react-router";
import { InstallScrim } from "#/machine/install-scrim";
import { FeedbackPicker } from "#/components/feedback-picker";
import { HelpChord } from "#/route/help";
import { MachineAttention } from "#/machine/attention";
import { OsNotices } from "#/machine/os-notices";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { OwnerInspector } from "#/state/owner-inspector";

export function AppChrome() {
  return (
    <>
      <MachineAttention />
      <OsNotices />
      <FeedbackPicker hideTrigger />
      <HelpChord />
    </>
  );
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

export function AppUtilities() {
  const location = useRouterState({ select: (state) => state.location });
  return (
    <>
      <AppChrome />
      <InstallScrim />
      <AppDevtools pathname={location.pathname} shell={String(location.search.shell ?? "")} />
    </>
  );
}
