import { useEffect } from "react";
import { planWaits } from "@pe/agent-contracts";
import { useMachine } from "./use-machine";

/** Runtime attention stays observable even while Settings is not mounted. */
export function MachineAttention() {
  const { reading } = useMachine();
  const waiting = reading.state === "ready" ? !!planWaits(reading.observation) : false;
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    try {
      void (waiting ? navigator.setAppBadge() : navigator.clearAppBadge()).catch((error) => { console.error("attention: asynchronous operation failed", error); });
    } catch (error) { console.warn("ts/apps/web/src/machine/attention.tsx: fallback after failure", error);
      /* Browser-owned badging can be unavailable outside an installed window. */
    }
  }, [waiting]);
  return null;
}
