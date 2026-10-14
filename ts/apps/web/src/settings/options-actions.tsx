import { Gauge, MessageCircle } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import { HotkeyCommand } from "#/components/lang/hotkey-command";
import { startFeedback } from "#/components/feedback-picker";
import { RouteControlsOutlet, useRouteControlPresence } from "#/navigation/route-controls";

/** Commands retain their real callbacks and never become persisted options. */
export function SettingsActions({ close }: { close?: () => void }) {
  const inspector = useRouteControlPresence("inspector");
  const feedback = () => {
    close?.();
    startFeedback();
  };
  return (
    <div className="flex flex-col gap-1" aria-label="Settings commands">
      <RouteControlsOutlet slot="inspector" className="pe-settings-row" />
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
    </div>
  );
}
