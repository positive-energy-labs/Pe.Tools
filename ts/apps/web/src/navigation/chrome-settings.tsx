import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useRouterState } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { appRouteByPath } from "@pe/agent-contracts";
import { Button } from "#/components/lang/button";
import { SettingsProjection } from "#/settings/options";
import { SettingsActions } from "#/settings/options-actions";
import { useSurfaceHost } from "./surface-host";
import { useDestination } from "./state";
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
    go(
      `/settings${subject && subject !== "settings" ? `?subject=${encodeURIComponent(subject)}` : ""}`,
    );
  };
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
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next || !ownsOpenPopup(popup.current)) setOpen(next);
      }}
    >
      <Popover.Trigger
        render={
          <Button label="Settings" icon={Settings2} data-chrome-settings>
            {word ? "Settings" : null}
          </Button>
        }
      />
      <Popover.Portal keepMounted>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-popup">
          <Popover.Popup
            ref={popup}
            data-surface="page"
            className="float-surface min-w-48 p-1"
            role="dialog"
            aria-label="Settings menu"
          >
            <div className="p-1">
              <SettingsProjection quick subject={subject} />
            </div>
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
                  go("/settings");
                }}
              >
                Providers and agent approvals
              </Button>
            </span>
            <SettingsActions close={close} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
