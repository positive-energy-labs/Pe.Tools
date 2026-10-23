import { useRef, useState } from "react";
import {
  Popover,
  SubjectPopoverContent as PopoverContent,
  PopoverTrigger,
} from "@pe/kit/lang/popover";
import { useRouterState } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { appRouteByPath } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { SettingsProjection } from "#/settings/options";
import { SettingsActions } from "#/settings/options-actions";
import { RouteControlsOutlet } from "./route-controls";
import { useSurfaceHost } from "./surface-host";
import { useDestination } from "./state";
import { settingsDestination } from "#/machine/model";
import { ownsOpenPopup } from "./situation-drawer";

export function ChromeSettings({ word = false }: { word?: boolean }) {
  const host = useSurfaceHost();
  const go = useDestination();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const subject = appRouteByPath(pathname)?.key;
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  const openSettings = () => {
    close();
    go(settingsDestination());
  };
  // A shell that draws Settings as a bar icon has its one door already.
  if (host.shell.icons.some((icon) => icon.route === "settings")) return null;
  if (host.shell.settings === "route")
    return (
      <Button
        label="Settings"
        icon={Settings2}
        pressed={pathname === "/settings"}
        onClick={openSettings}
        data-chrome-settings
      >
        {word ? "Settings" : null}
      </Button>
    );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next || !ownsOpenPopup(popup.current)) setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button label="Settings" icon={Settings2} data-chrome-settings>
            {word ? "Settings" : null}
          </Button>
        }
      />
      <PopoverContent
        keepMounted
        ref={popup}
        data-surface="page"
        className="w-auto min-w-48 p-1"
        role="dialog"
        aria-label="Settings menu"
      >
        <div className="p-1">
          <SettingsProjection quick subject={subject} />
        </div>
        {/* The active route's own section, put here by PrimaryRouteControls slot="settings". */}
        <RouteControlsOutlet slot="settings" as="div" className="p-1 empty:hidden" />
        <span className="pe-settings-row">
          <Button label="All settings" onClick={openSettings}>
            All settings
          </Button>
        </span>
        <span className="pe-settings-row">
          <Button
            label="Providers and agent approvals"
            onClick={() => {
              close();
              go(settingsDestination("pea"));
            }}
          >
            Providers and agent approvals
          </Button>
        </span>
        <SettingsActions close={close} />
      </PopoverContent>
    </Popover>
  );
}
