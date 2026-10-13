/**
 * The install scrim: while an update installs, the whole app is dimmed and inert, with the current
 * leg said over it, so nobody wonders whether the page can be used. It is a modal Dialog nobody can
 * dismiss, driven by the host's receipt (`installing`), never a timer.
 *
 * The successor host is a different build. This page's JS names the old runtime service and the new
 * host refuses it, so re-subscribing can never recover: once the host is gone the page polls
 * (`probeSuccessor`) and does a full reload when a different build answers. The wait is bounded; past
 * the bound the scrim says so and offers Reload and Dismiss instead of trapping the page.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Machine, Reading } from "@pe/agent-contracts";

import { Button } from "#/components/lang/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/lang/dialog";
import { OutcomeLine } from "#/components/lang/outcome";
import { probeSuccessor, type SuccessorProbe } from "#/host/install";

import { isAccepting, subscribeAccepting } from "./accepting";
import { installing } from "./model";
import { useMachine } from "./use-machine";

export const SUCCESSOR_POLL_MS = 2_000;
/** MSI, then the relaunch: past this the successor is not coming by itself. */
export const SUCCESSOR_WAIT_MS = 10 * 60_000;

export function InstallGate({
  reading,
  fixture,
  probe = probeSuccessor,
  reload = () => location.reload(),
}: {
  reading: Reading<Machine>;
  fixture: boolean;
  probe?: (version: string | null) => Promise<SuccessorProbe>;
  reload?: () => void;
}) {
  const accepting = useSyncExternalStore(subscribeAccepting, isAccepting, () => false);
  const state = fixture ? null : installing(reading, accepting);
  const active = state !== null;
  const [expired, setExpired] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!active) {
      setExpired(false);
      setDismissed(false);
      return;
    }
    const timer = setTimeout(() => setExpired(true), SUCCESSOR_WAIT_MS);
    return () => clearTimeout(timer);
  }, [active]);
  const polling = state?.gone === true && !expired;
  const version = state?.version ?? null;
  useEffect(() => {
    if (!polling) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const answer = await probe(version).catch((): SuccessorProbe => "down");
      if (!live) return;
      if (answer === "successor") reload();
      else timer = setTimeout(() => void tick(), SUCCESSOR_POLL_MS);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // probe and reload are call-site constants; a new identity must not restart the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, version]);
  return (
    <Dialog open={active && !dismissed} onOpenChange={() => {}} disablePointerDismissal>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{state?.to ? `Updating to ${state.to}` : "Updating"}</DialogTitle>
        </DialogHeader>
        <div role="status" className="flex flex-col gap-2">
          {expired ? (
            <OutcomeLine
              kind="error"
              label={
                state?.gone
                  ? "The new host has not answered in 10 minutes"
                  : "The update has not finished in 10 minutes"
              }
            />
          ) : (
            <OutcomeLine kind="busy" label={state?.leg ?? ""} />
          )}
          <span className="text-ink-2">
            {expired
              ? "Reload to look again, or dismiss this and check the machine drawer."
              : "Nothing on this page can be used until the update finishes. It reloads by itself."}
          </span>
          {expired ? (
            <span className="flex items-center gap-2">
              <Button label="reload" kind="framed" onClick={reload}>
                reload
              </Button>
              <Button label="dismiss" onClick={() => setDismissed(true)}>
                dismiss
              </Button>
            </span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Mounted once at the app root, over every page including the tray. */
export function InstallScrim() {
  const { reading, fixture } = useMachine();
  return <InstallGate reading={reading} fixture={fixture} />;
}
