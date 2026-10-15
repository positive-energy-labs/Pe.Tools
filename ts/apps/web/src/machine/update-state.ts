/**
 * The update, as one state machine over the one persisted fact (`Machine.update`): never a second
 * writable model. The host owns the plan, the admission and the receipt; this derives the seven
 * states every surface says, so the chip, the Update group, the scrim and the tray cannot disagree.
 *
 * The SDK's `update apply` downloads, closes Revit, installs, reopens documents and relaunches in
 * one receipt, so a download is the first leg of an admitted apply, not a staged step before it:
 * `ready` means one press from installing, with nothing left to resolve.
 */
import type { Machine } from "@pe/agent-contracts";
import type { UpdatePlan } from "@pe/host-contracts/pe-revit-contract";

import { planWaits, receiptRunning } from "./model";

export type UpdateStatus =
  | { readonly state: "idle"; readonly current: string | null; readonly checkError: string | null }
  | { readonly state: "checking" }
  | { readonly state: "available"; readonly plan: UpdatePlan }
  | { readonly state: "ready"; readonly plan: UpdatePlan }
  | { readonly state: "downloading"; readonly to: string | null }
  | { readonly state: "applying"; readonly to: string | null; readonly leg: string }
  | { readonly state: "failed"; readonly during: "check" | "apply"; readonly message: string };

/**
 * `checking` is the press in flight on this surface; the host answers a recheck in one request, so
 * no other surface needs to see it.
 */
export function updateStatus(machine: Machine, checking: boolean): UpdateStatus {
  const { plan, receipt, planLeg, admittedPlanId } = machine.update;
  const to = plan?.latest ?? null;
  if (receipt && receiptRunning(machine)) {
    const last = receipt.legs.at(-1);
    return !last || last.name.startsWith("download")
      ? { state: "downloading", to }
      : { state: "applying", to, leg: last.name };
  }
  // Consent is admitted and the first receipt is not read yet: the apply has begun with its download.
  if (plan && admittedPlanId === plan.planId && receipt === null)
    return { state: "downloading", to };
  const waiting = planWaits(machine);
  if ((receipt?.state === "failed" || receipt?.state === "refused") && !waiting)
    return {
      state: "failed",
      during: "apply",
      message:
        receipt.legs.at(-1)?.detail ??
        (receipt.state === "refused" ? "The update was refused." : "The update failed."),
    };
  if (checking) return { state: "checking" };
  if (waiting)
    return waiting.blockers.length || waiting.revits.some((revit) => revit.blockers.length)
      ? { state: "available", plan: waiting }
      : { state: "ready", plan: waiting };
  if (!plan && planLeg.error) return { state: "failed", during: "check", message: planLeg.error };
  return { state: "idle", current: plan?.current ?? null, checkError: planLeg.error };
}

type Said = { readonly text: string; readonly tone?: "caution" | "alarm" | "done" };

/** The Update group's header and the chip: the state in a few words. */
export function updateSaid(machine: Machine, checking = false): Said {
  const status = updateStatus(machine, checking);
  switch (status.state) {
    case "checking":
      return { text: "checking" };
    case "downloading":
      return { text: status.to ? `downloading ${status.to}` : "downloading" };
    case "applying":
      return { text: `updating · ${status.leg}` };
    case "failed":
      return status.during === "check"
        ? { text: "check failed", tone: "caution" }
        : { text: `update ${machine.update.receipt?.state ?? "failed"}`, tone: "alarm" };
    case "available":
      return { text: `${status.plan.latest} · blocked`, tone: "caution" };
    case "ready":
      return { text: `${status.plan.latest} · waits for you`, tone: "caution" };
    case "idle":
      return machine.update.plan?.available
        ? { text: `${machine.update.plan.latest} · admitted` }
        : machine.update.plan
          ? { text: `up to date · ${status.current}` }
          : { text: "unread" };
  }
}
