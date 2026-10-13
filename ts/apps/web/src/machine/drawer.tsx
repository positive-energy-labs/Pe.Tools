/**
 * The machine layer's door: current version and runtime ownership at bottom-right.
 * Esc and × close the drawer and return focus. The tray draws the same body without this chrome.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { X } from "lucide-react";

import { Button } from "#/components/lang/button";

import { MachineBody } from "./body";
import { closeMachine, drawerState, openMachine, subscribeDrawer } from "./door";
import { chipText, planWaits, runtimeIdentity } from "./model";
import { useMachine } from "./use-machine";

/** The tutorial's machine door uses the same observation and drawer as global chrome. */
export function MachineHelpTrigger({ onOpen }: { onOpen?: () => void }) {
  const { reading, fixture } = useMachine();
  return (
    <Button
      label="This machine"
      reason={runtimeIdentity(reading, fixture).detail}
      onClick={() => {
        onOpen?.();
        openMachine();
      }}
    >
      This machine
      {chipText(reading, fixture) ? (
        <>
          {" · "}
          <span className="face-mono">{chipText(reading, fixture)}</span>
        </>
      ) : null}
    </Button>
  );
}

export function VersionChip({ hideTrigger = false }: { hideTrigger?: boolean }) {
  const { reading, fixture } = useMachine();
  const state = useSyncExternalStore(subscribeDrawer, drawerState, drawerState);
  const chip = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
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
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMachine();
      (chip.current ?? (returnFocus.current?.isConnected ? returnFocus.current : null))?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.open]);
  const shut = () => {
    closeMachine();
    (chip.current ?? (returnFocus.current?.isConnected ? returnFocus.current : null))?.focus();
  };
  return (
    <>
      {/* Chat reaches this drawer through its tutorial; other routes keep the global door. */}
      {!hideTrigger && chipText(reading, fixture) ? (
        <span className="fixed right-(--gutter) bottom-(--gutter) z-sticky flex h-(--rail-h) items-center">
          <Button
            ref={chip}
            label={chipText(reading, fixture)}
            kind="framed"
            aria-expanded={state.open}
            aria-controls="machine-drawer"
            data-tone={waiting ? "caution" : undefined}
            reason={identity.detail}
            onClick={() => (state.open ? shut() : openMachine())}
          >
            <span className="face-mono">{chipText(reading, fixture)}</span>
          </Button>
        </span>
      ) : null}
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
              <Button ref={close} label="close" reason="close (Esc)" icon={X} onClick={shut} />
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
