import { Gauge, MessageCircle, Server } from "lucide-react";
import { Button } from "#/components/lang/button";
import { HotkeyCommand } from "#/components/lang/hotkey-command";
import { startFeedback } from "#/components/feedback-picker";
import { RouteControlsSlot, useRouteSlotPresence } from "#/navigation/route-controls";
import { useDestination } from "#/navigation/state";

/** Commands retain their real callbacks and never become persisted options. */
export function SettingsActions({ close }: { close?: () => void }) {
  const inspector = useRouteSlotPresence("inspector");
  const go = useDestination();
  const feedback = () => {
    close?.();
    startFeedback();
  };
  return (
    <div className="flex flex-col gap-1" aria-label="Settings commands">
      <RouteControlsSlot slot="inspector" className="pe-settings-row" />
      {!inspector && (
        <span className="pe-settings-row">
          <Button label="Inspector" icon={Gauge} refusal="This page exposes no route inspector">
            Inspector
          </Button>
        </span>
      )}
      <span className="pe-settings-row">
        <HotkeyCommand
          bind={false}
          label="Feedback"
          word="Feedback"
          face="full"
          hotkey={{ key: ".", mod: true, shift: true }}
          icon={MessageCircle}
          invoke={feedback}
        />
      </span>
      <span className="pe-settings-row">
        <Button
          label="Machine"
          icon={Server}
          onClick={() => {
            close?.();
            go("/machine");
          }}
        >
          Machine
        </Button>
      </span>
    </div>
  );
}
