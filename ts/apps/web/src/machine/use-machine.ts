/**
 * The one way a shell reads the machine, and the one update mutation. In the frozen demo lane
 * (`?demo=<name>`) the reading is a recorded fixture and nothing reaches a host; a mutation there
 * is refused with that reason instead of being sent.
 */
import { useCallback, useState, useSyncExternalStore } from "react";
import type { Machine, Reading } from "@pe/agent-contracts";

import { frozenDemo } from "#/host/demo-client";
import { acknowledgeUpdate } from "#/host/install";
import { MACHINE_SEEDS, OPEN_SEEDS } from "#/open/seeds";
import { dirty, useAction, useReading } from "#/readings";

import { machineOf, planWaits } from "./model";

const ABSENT: Reading<Machine> = { state: "absent" };

/** The recorded machine a frozen demo draws: a machine fixture by name, else the Open seed's. */
export function demoMachine(demo: string): Reading<Machine> {
  if (Object.hasOwn(MACHINE_SEEDS, demo)) return MACHINE_SEEDS[demo as keyof typeof MACHINE_SEEDS];
  const seeded = OPEN_SEEDS[demo as keyof typeof OPEN_SEEDS]?.readings.machine as
    | Machine
    | undefined;
  return seeded ? { state: "ready", observation: seeded } : ABSENT;
}

const still = () => () => {};

export const SEED_REFUSAL = "Fixture: nothing on this page reaches a host.";

export function useMachine(): { reading: Reading<Machine>; fixture: boolean } {
  // The server renders the live lane; the client hydrates it, then reads the URL's demo seed.
  const demo = useSyncExternalStore(still, frozenDemo, () => null);
  const live = useReading<Machine>(demo ? null : { kind: "machine" });
  return demo ? { reading: demoMachine(demo), fixture: true } : { reading: live, fixture: false };
}

/**
 * Consent binds the plan id at the moment of the press. Automatic admission belongs to the host.
 */
export function useUpdateConsent(reading: Reading<Machine>, fixture: boolean) {
  const machine = machineOf(reading);
  const [requestId, setRequestId] = useState<string | null>(null);
  const run = useCallback(async (planId: string) => {
    try {
      return await acknowledgeUpdate(planId);
    } finally {
      dirty({ kind: "machine" });
    }
  }, []);
  const apply = useAction(run, setRequestId);
  const waiting = machine ? planWaits(machine) : null;
  const refusal = fixture
    ? SEED_REFUSAL
    : reading.state !== "ready"
      ? "The machine reading is not current; wait for the host to answer."
      : !waiting
        ? "No update plan waits for consent."
        : waiting.blockers.length
          ? "Resolve the blocker above first; the host re-plans when it clears."
          : requestId && machine?.update.requestId === requestId && machine.update.receipt === null
            ? "This plan was admitted; the receipt follows."
            : null;
  return {
    plan: waiting,
    refusal,
    requestId,
    pending: apply.isPending,
    error: apply.error,
    consent: () => waiting && refusal === null && apply.mutate(waiting.planId),
  };
}
