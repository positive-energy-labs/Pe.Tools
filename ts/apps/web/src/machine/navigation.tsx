import { Button } from "@pe/kit/lang/button";
import { useDestination } from "#/navigation/state";
import { chipText, runtimeIdentity, settingsDestination } from "./model";
import { useMachine } from "./use-machine";

/** Help enters the same Settings address as search and the tray's Settings door. */
export function SettingsHelpTrigger({ onOpen }: { onOpen?: () => void }) {
  const { reading, fixture } = useMachine();
  const go = useDestination();
  const chip = chipText(reading, fixture);
  return (
    <Button
      label="Settings"
      reason={runtimeIdentity(reading, fixture).detail}
      onClick={() => {
        onOpen?.();
        go(settingsDestination());
      }}
    >
      Settings
      {chip ? <span className="face-mono"> · {chip}</span> : null}
    </Button>
  );
}
