/**
 * The machine layer's one door on every web page: a version chip bottom-left reading
 * `Pe.Tools <version>`, or `<next> ready` while an update plan waits for consent. Update is the
 * only machine state that surfaces outside the drawer (host ledger 2026-10-09 ruling 3). The chip
 * slides in a 380 px drawer holding the machine body; Esc and × close it and focus returns to the
 * chip. The tray route draws the same body without this chrome, so neither renders there.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { X } from "lucide-react";

import { Press } from "#/components/lang/press";

import { MachineBody } from "./body";
import { closeMachine, drawerState, openMachine, subscribeDrawer } from "./door";
import { chipText, machineOf, planWaits } from "./model";
import { useMachine, useUpdateConsent } from "./use-machine";

export function VersionChip() {
  const { reading, fixture } = useMachine();
  // The chip is mounted on every page: it is where a quiet plan applies without asking, once.
  useUpdateConsent(reading, fixture, true);
  const state = useSyncExternalStore(subscribeDrawer, drawerState, drawerState);
  const chip = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const machine = machineOf(reading);
  const waiting = machine ? planWaits(machine) : null;
  useEffect(() => {
    if (!state.open) return;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMachine();
      chip.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.open]);
  const shut = () => {
    closeMachine();
    chip.current?.focus();
  };
  return (
    <>
      <span className="fixed bottom-2 left-2 z-sticky">
        <Press
          ref={chip}
          tone="quiet"
          size="caption"
          frame="line"
          aria-expanded={state.open}
          aria-controls="machine-drawer"
          data-tone={waiting ? "caution" : undefined}
          title={
            waiting
              ? `Pe.Tools ${waiting.latest} is ready; open this machine to update`
              : "this machine: Revit, update, share, Pea and the host"
          }
          onClick={() => (state.open ? shut() : openMachine())}
        >
          <span className="face-mono">{chipText(machine)}</span>
        </Press>
      </span>
      {state.open ? (
        <aside
          id="machine-drawer"
          aria-label="this machine"
          data-surface="page"
          className="hairline-r fixed inset-y-0 left-0 z-popup flex w-[380px] flex-col gap-2 overflow-y-auto px-3 pt-2 pb-12"
        >
          <span className="flex h-(--control-h) items-center gap-2">
            <span className="font-semibold">This machine</span>
            <span className="ml-auto">
              <Press
                ref={close}
                tone="quiet"
                size="icon"
                title="close (Esc)"
                aria-label="close"
                onClick={shut}
              >
                <X className="size-4" strokeWidth={1.5} />
              </Press>
            </span>
          </span>
          <MachineBody
            key={state.group ?? "auto"}
            reading={reading}
            fixture={fixture}
            shell="drawer"
            group={state.group}
          />
        </aside>
      ) : null}
    </>
  );
}
