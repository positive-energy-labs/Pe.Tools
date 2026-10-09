/**
 * The one way a shell reads the machine, and the one update mutation. In the frozen demo lane
 * (`?demo=<name>`) the reading is a recorded fixture and nothing reaches a host; a mutation there
 * is refused with that reason instead of being sent.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
 * Consent binds the plan id at the moment of the press (host ledger 2026-10-08). `quiet` applies a
 * quiet plan without asking, once per app open; only the always-mounted version chip passes it.
 */
export function useUpdateConsent(reading: Reading<Machine>, fixture: boolean, quiet = false) {
  const machine = machineOf(reading);
  const [requestId, setRequestId] = useState<string | null>(null);
  const run = useCallback(async (planId: string) => {
    const admitted = await acknowledgeUpdate(planId);
    dirty({ kind: "machine" });
    return admitted;
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
          : requestId
            ? "This plan was admitted; the receipt follows."
            : null;
  const started = useRef(false);
  const autoApply =
    quiet &&
    !fixture &&
    refusal === null &&
    waiting?.quiet === true &&
    machine?.host?.payload === "installed";
  useEffect(() => {
    if (!autoApply || started.current || !waiting) return;
    started.current = true;
    apply.mutate(waiting.planId);
  }, [autoApply, waiting, apply]);
  return {
    plan: waiting,
    refusal,
    requestId,
    pending: apply.isPending,
    error: apply.error,
    consent: () => waiting && refusal === null && apply.mutate(waiting.planId),
  };
}
