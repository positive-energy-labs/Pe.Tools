/**
 * The Machine reading, said in words: the version chip, the status line, and each group's
 * critical state. Pure functions of the one reading the host computes (host ledger 2026-10-09
 * ruling 2); a shell never computes machine state of its own. No connected flag exists: the
 * reading arriving is the answer, and a reading that stopped arriving says so only inside the
 * machine body.
 */
import type { Machine, MachineSession, Reading } from "@pe/agent-contracts";
import type { UpdateBlocker, UpdatePlan, UpdateRevit } from "@pe/host-contracts/pe-revit-contract";

import { phaseOf, unsavedOf } from "./session";

export type GroupKey = "revit" | "update" | "share" | "pea";

export const machineOf = (reading: Reading<Machine>): Machine | null =>
  reading.state === "ready"
    ? reading.observation
    : reading.state === "absent"
      ? null
      : (reading.previous ?? null);

/** The host stopped answering after it had answered: the honest gap, said in the body. */
export const disconnected = (reading: Reading<Machine>) =>
  reading.state === "stale" && reading.reason === "disconnected";

const SETTLED = new Set(["ok", "failed", "refused"]);
export const receiptRunning = (machine: Machine) =>
  machine.update.receipt !== null && !SETTLED.has(machine.update.receipt.state);

/** A plan that waits on this person: available, not yet admitted, nothing applying. */
export const planWaits = (machine: Machine): UpdatePlan | null => {
  const plan = machine.update.plan;
  return plan?.available &&
    plan.latest &&
    machine.update.admittedPlanId !== plan.planId &&
    !receiptRunning(machine)
    ? plan
    : null;
};

/** `Pe.Tools 0.7.0`, or `0.7.1 ready` while a plan waits for consent. */
export function chipText(machine: Machine | null): string {
  const waiting = machine && planWaits(machine);
  if (waiting) return `${waiting.latest} ready`;
  return machine?.host ? `Pe.Tools ${machine.host.version}` : "Pe.Tools";
}

/** `UpdateBlocker` has no pid: the Revit is the `plan.revits[]` row holding the same blocker. */
export function blockersOf(
  plan: UpdatePlan,
): { blocker: UpdateBlocker; revit: UpdateRevit | null }[] {
  const same = (a: UpdateBlocker, b: UpdateBlocker) => a.code === b.code && a.detail === b.detail;
  const held = plan.revits.flatMap((revit) =>
    revit.blockers.map((blocker) => ({ blocker, revit })),
  );
  const loose = plan.blockers
    .filter((blocker) => !held.some((row) => same(row.blocker, blocker)))
    .map((blocker) => ({ blocker, revit: null }));
  return [...held, ...loose];
}

const blockedBy = (plan: UpdatePlan) => {
  const first = blockersOf(plan)[0];
  return (
    first?.revit?.documents.find((document) => document.isModified)?.title ??
    (first?.revit ? `Revit ${first.revit.year}` : (first?.blocker.code ?? "a blocker"))
  );
};

/** What waits on the person, in sentences. Providers never light it. */
export function attention(machine: Machine): string[] {
  const out: string[] = [];
  const plan = planWaits(machine);
  if (plan && plan.blockers.length) out.push(`Update ${plan.latest} blocked by ${blockedBy(plan)}`);
  else if (plan) out.push(`Update ${plan.latest} waits for you`);
  for (const session of machine.revit.sessions ?? [])
    if (session.row.case === "controlled-active" && session.row.dialogs)
      out.push(`Revit ${session.row.year} shows a dialog`);
  const share = machine.share;
  if (share?.state === "on" && share.refused.length)
    out.push(
      `${share.refused.length} share request${share.refused.length === 1 ? "" : "s"} refused`,
    );
  return out;
}

/** The group that opens by itself: Update while a plan waits or a receipt runs (ruling). */
export function autoOpen(machine: Machine | null): GroupKey | null {
  if (!machine) return null;
  if (planWaits(machine) || receiptRunning(machine)) return "update";
  if (
    (machine.revit.sessions ?? []).some(
      (session) => session.row.case === "controlled-active" && session.row.dialogs,
    )
  )
    return "revit";
  if (machine.share?.state === "on" && machine.share.refused.length) return "share";
  return null;
}

type Said = { readonly text: string; readonly tone?: "caution" | "alarm" | "done" };

export function revitState(machine: Machine): Said {
  const sessions: readonly MachineSession[] | null = machine.revit.sessions;
  if (sessions === null)
    return {
      text: machine.legs.sessions?.error ? "census failed" : "census unread",
      tone: "caution",
    };
  if (!sessions.length) return { text: "none running" };
  const booting = sessions.filter((session) => phaseOf(session.row) === "booting").length;
  const unsaved = sessions.filter((session) => unsavedOf(session).length).length;
  const dialogs = sessions.filter(
    (session) => session.row.case === "controlled-active" && session.row.dialogs,
  ).length;
  return {
    text: [
      `${sessions.length} running`,
      booting ? `${booting} booting` : null,
      unsaved ? `${unsaved} unsaved` : null,
      dialogs ? `${dialogs} dialog` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    tone: dialogs ? "caution" : undefined,
  };
}

export function updateState(machine: Machine): Said {
  const { plan, receipt, planLeg } = machine.update;
  if (receipt && receiptRunning(machine))
    return { text: `updating · ${receipt.legs.at(-1)?.name ?? "admitted"}` };
  if (receipt?.state === "failed" || receipt?.state === "refused")
    return { text: `update ${receipt.state}`, tone: "alarm" };
  if (!plan) return planLeg.error ? { text: "check failed", tone: "caution" } : { text: "unread" };
  const waiting = planWaits(machine);
  if (waiting)
    return waiting.blockers.length
      ? { text: `${waiting.latest} · blocked`, tone: "caution" }
      : { text: `${waiting.latest} · waits for you`, tone: "caution" };
  if (plan.available) return { text: `${plan.latest} · admitted` };
  return { text: `up to date · ${plan.current}` };
}

export function shareState(machine: Machine): Said {
  const share = machine.share;
  if (!share)
    return { text: machine.legs.share?.error ? "read failed" : "unread", tone: "caution" };
  if (share.state === "refused") return { text: "refused", tone: "caution" };
  if (share.state === "unknown") return { text: "unknown", tone: "caution" };
  if (share.desired !== share.state) return { text: `turning ${share.desired}` };
  return { text: share.state === "on" && share.url ? `on · ${hostOfUrl(share.url)}` : share.state };
}

export function peaState(machine: Machine): Said {
  if (machine.legs.providers?.error) return { text: "provider state unreadable", tone: "caution" };
  const providers = machine.providers;
  if (!providers) return { text: "unread", tone: "caution" };
  const ready = providers.filter((provider) => provider.readiness.state === "ready");
  if (!ready.length) return { text: "no provider ready", tone: "caution" };
  const stale = ready.some(
    (provider) =>
      provider.probedAt === null || Date.now() - Date.parse(provider.probedAt) >= 60_000,
  );
  return {
    text: `${ready.length} of ${providers.length} ${stale ? "last ready" : "ready"}`,
    ...(stale ? { tone: "caution" as const } : {}),
  };
}

export const hostOfUrl = (url: string) => url.replace(/^https?:\/\//, "").split(/[./]/)[0]!;

export const hhmm = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : "—");

export function uptimeWords(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
