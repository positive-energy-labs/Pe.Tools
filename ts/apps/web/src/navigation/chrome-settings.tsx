import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Settings2, MessageCircle, Server, Gauge } from "lucide-react";
import { Button } from "#/components/lang/button";
import { HotkeyCommand } from "#/components/lang/hotkey-command";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { startFeedback } from "#/components/feedback-picker";
import { openMachine } from "#/machine/door";
import { RouteControlsSlot, useRouteSlotPresence } from "./route-controls";
import { ownsOpenPopup } from "./situation-drawer";

export function ChromeSettings() {
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const inspector = useRouteSlotPresence("inspector");
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next || !ownsOpenPopup(popup.current)) setOpen(next);
      }}
    >
      <Popover.Trigger render={<Button label="Settings" icon={Settings2} data-chrome-settings />} />
      <Popover.Portal keepMounted>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-popup">
          <Popover.Popup
            ref={popup}
            data-surface="page"
            className="float-surface min-w-48 p-1"
            role="dialog"
            aria-label="Settings menu"
          >
            <RouteControlsSlot slot="inspector" className="pe-settings-row" />
            {!inspector && (
              <span className="pe-settings-row">
                <Button
                  label="Inspector"
                  icon={Gauge}
                  refusal="This page exposes no route inspector"
                >
                  Inspector
                </Button>
              </span>
            )}
            <span className="pe-settings-row">
              <ThemeToggle labelled />
            </span>
            <span className="pe-settings-row">
              <HotkeyCommand
                label="Feedback"
                word="Feedback"
                face="full"
                hotkey={{ key: ".", mod: true, shift: true }}
                icon={MessageCircle}
                invoke={() => {
                  setOpen(false);
                  startFeedback();
                }}
              />
            </span>
            <span className="pe-settings-row">
              <Button
                label="Machine"
                icon={Server}
                onClick={() => {
                  setOpen(false);
                  openMachine();
                }}
              >
                Machine
              </Button>
            </span>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
