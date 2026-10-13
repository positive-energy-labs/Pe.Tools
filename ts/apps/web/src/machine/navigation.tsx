import { Button } from "#/components/lang/button";
import { useDestination } from "#/navigation/state";
import { chipText, runtimeIdentity, type GroupKey } from "./model";
import { useMachine } from "./use-machine";

export const machineDestination = (section?: GroupKey) =>
  `/machine${section ? `?section=${section}` : ""}`;

export const settingsDestination = (section: "providers" | "sharing" | "startup") =>
  `/settings?subject=machine&section=${section}`;

export function useMachineNavigation() {
  const go = useDestination();
  return (section?: GroupKey) => go(machineDestination(section));
}

/** Help enters the same address as search and the control window. */
export function MachineHelpTrigger({ onOpen }: { onOpen?: () => void }) {
  const { reading, fixture } = useMachine();
  const go = useMachineNavigation();
  return (
    <Button
      label="This machine"
      reason={runtimeIdentity(reading, fixture).detail}
      onClick={() => {
        onOpen?.();
        go();
      }}
    >
      This machine
      {chipText(reading, fixture) ? (
        <span className="face-mono"> · {chipText(reading, fixture)}</span>
      ) : null}
    </Button>
  );
}
