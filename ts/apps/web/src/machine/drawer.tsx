/**
 * The machine layer's door: current version and runtime ownership at bottom-right.
 * Esc and × close the drawer and return focus. The tray draws the same body without this chrome.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { X } from "lucide-react";

import { Press } from "#/components/lang/press";

import { MachineBody } from "./body";
import { closeMachine, drawerState, openMachine, subscribeDrawer } from "./door";
import { chipText, planWaits, runtimeIdentity } from "./model";
import { useMachine } from "./use-machine";

export function VersionChip() {
  const { reading, fixture } = useMachine();
  const state = useSyncExternalStore(subscribeDrawer, drawerState, drawerState);
  const chip = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const waiting = reading.state === "ready" ? planWaits(reading.observation) : null;
  const identity = runtimeIdentity(reading, fixture);
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    try {
      void (waiting ? navigator.setAppBadge() : navigator.clearAppBadge()).catch(() => {});
    } catch {
      // App badging can reject outside an installed window.
    }
  }, [!!waiting]);
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
      <span className="fixed right-2 bottom-2 z-sticky">
        <Press
          ref={chip}
          tone="quiet"
          size="caption"
          frame="line"
          aria-expanded={state.open}
          aria-controls="machine-drawer"
          data-tone={waiting ? "caution" : undefined}
          title={identity.detail}
          onClick={() => (state.open ? shut() : openMachine())}
        >
          <span className="face-mono">{chipText(reading, fixture)}</span>
        </Press>
      </span>
      {state.open ? (
        <aside
          id="machine-drawer"
          aria-label="this machine"
          data-surface="page"
          className="hairline-l fixed inset-y-0 right-0 z-popup flex w-[380px] max-w-full flex-col gap-2 overflow-y-auto px-3 pt-2 pb-12"
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
          <p className="break-all text-ink-2">{identity.detail}</p>
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
