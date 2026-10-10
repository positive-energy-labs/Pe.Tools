/**
 * The Update group: the plan in one sentence, each blocker with the Revit that holds it, consent
 * bound to this plan's id and refused while a blocker stands, Recheck, and the receipt's legs.
 * While the host is gone the strip says the honest gap: the last confirmed leg, then
 * "disconnected"; the successor host reads the receipt and the strip resumes (ruling 6).
 */
import type { Machine, Reading } from "@pe/agent-contracts";

import { ActionButton } from "#/components/lang/action-button";
import { LegStrip } from "#/components/lang/leg-strip";
import { OutcomeLine } from "#/components/lang/outcome";
import { PidChip } from "#/components/lang/process";
import { dirty, useAction } from "#/readings";
import { recheckUpdate } from "#/host/install";

import { blockersOf, disconnected, hhmm, machineOf, receiptRunning } from "./model";
import { SEED_REFUSAL, useUpdateConsent } from "./use-machine";

const mb = (bytes: number) => `${Math.round(bytes / 1_048_576)} MB`;

function Receipt({ machine, gap }: { machine: Machine; gap: boolean }) {
  const receipt = machine.update.receipt;
  const { requestId, receiptLeg } = machine.update;
  if (!receipt && !requestId && !receiptLeg.error) return null;
  const last = receipt?.legs.at(-1);
  const restorationFailed =
    receipt?.state === "ok" &&
    receipt.legs.some(
      (leg) =>
        (leg.name.startsWith("reopen:") || leg.name === "relaunch") && leg.status === "failed",
    );
  return (
    <div className="flex flex-col gap-1 pt-1" aria-label="update receipt">
      <LegStrip
        legs={receipt?.legs ?? []}
        unobserved={
          gap ? "not observed: the host is down; the next host reads the receipt" : undefined
        }
      />
      <span className="text-ink-2">
        {gap ? (
          <>
            Last confirmed <span className="face-mono">{last?.name ?? "admission"}</span> at{" "}
            <span className="face-mono">{hhmm(last?.observedAtUtc)}</span> ·{" "}
            <span data-tone="caution">disconnected</span>
          </>
        ) : receipt?.state === "ok" ? (
          <span data-tone="done">updated · read from the receipt</span>
        ) : receipt?.state === "failed" || receipt?.state === "refused" ? (
          <span data-tone="alarm">
            update {receipt.state}
            {last?.detail ? `: ${last.detail}` : ""}
          </span>
        ) : (
          <>
            {receipt?.state ?? "awaiting receipt"} ·{" "}
            <span className="face-mono">{last?.name ?? "admitted"}</span>
          </>
        )}
      </span>
      {requestId ? <span className="face-mono text-ink-2">request {requestId}</span> : null}
      {receiptLeg.error ? (
        <OutcomeLine kind="refused" label={`Receipt read failed: ${receiptLeg.error}`} />
      ) : null}
      {restorationFailed ? (
        <span data-tone="caution">
          Updated. Some documents or the app did not reopen; reopen them from Open.
        </span>
      ) : null}
    </div>
  );
}

export function UpdateGroup({ reading, fixture }: { reading: Reading<Machine>; fixture: boolean }) {
  const machine = machineOf(reading);
  const consent = useUpdateConsent(reading, fixture);
  const check = useAction<void, void>(async () => {
    try {
      await recheckUpdate();
    } finally {
      dirty({ kind: "machine" });
    }
  });
  if (!machine) return null;
  const gap = disconnected(reading);
  const { plan, planLeg } = machine.update;
  const recheck = (
    <>
      <ActionButton
        label="recheck"
        reason={
          fixture ? SEED_REFUSAL : "read the update feed again and re-plan against every Revit"
        }
        disabled={fixture || gap}
        busy={check.isPending}
        onClick={() => check.mutate()}
      />
      {check.error ? <OutcomeLine kind="refused" label={check.error.message} /> : null}
    </>
  );
  if (!plan)
    return (
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          {planLeg.error ? (
            <span data-tone="caution">Update check failed: {planLeg.error}</span>
          ) : (
            <span className="text-ink-2">The update feed has not been read yet.</span>
          )}
          <span className="ml-auto">{recheck}</span>
        </span>
        <Receipt machine={machine} gap={gap} />
      </div>
    );
  if (!plan.available || receiptRunning(machine))
    return (
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          {plan.available ? (
            <span>
              Updating to <span className="face-mono">{plan.latest}</span>
            </span>
          ) : (
            <span>
              Up to date <span className="face-mono">{plan.current}</span>
            </span>
          )}
          <span className="text-ink-2">checked {hhmm(plan.observedAtUtc)}</span>
          <span className="ml-auto">{recheck}</span>
        </span>
        <Receipt machine={machine} gap={gap} />
      </div>
    );
  const blockers = blockersOf(plan);
  const closing = plan.effects.close.length;
  const reopening = plan.effects.reopen.length;
  const unknown = plan.revits.filter((revit) => revit.unknown);
  return (
    <div className="flex flex-col gap-1" aria-label="update plan">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold">
          Update to <span className="face-mono">{plan.latest}</span>
        </span>
        <span className="text-ink-2">
          from <span className="face-mono">{plan.current}</span>
          {plan.msi ? ` · ${mb(plan.msi.size)}` : ""}
        </span>
        <span
          className="ml-auto face-mono text-ink-2"
          title={`consent binds to ${plan.planId}; a changed Revit re-plans and asks again`}
        >
          {plan.planId.slice(-9)}
        </span>
      </span>
      {blockers.map(({ blocker, revit }) => (
        <div
          key={`${blocker.code}-${revit?.pid ?? "plan"}`}
          className="flex flex-col"
          aria-label="blocker"
        >
          <span className="flex flex-wrap items-center gap-1.5">
            <span data-tone="caution">Blocked by</span>
            {revit ? <PidChip pid={revit.pid} /> : null}
            {revit ? (
              <span className="font-semibold">
                {revit.documents.find((document) => document.isModified)?.title ??
                  `Revit ${revit.year}`}
              </span>
            ) : null}
            {revit ? <span className="text-ink-2">Revit {revit.year}</span> : null}
          </span>
          <span className="text-ink-2">
            {blocker.detail} <span className="face-mono">{blocker.code}</span>
          </span>
        </div>
      ))}
      <span className="text-ink-2">
        Closes {closing} Revit{closing === 1 ? "" : "s"} keeping their work, installs, then reopens{" "}
        {reopening} document{reopening === 1 ? "" : "s"}.
        {unknown.length
          ? ` Revit ${unknown.map((revit) => revit.year).join(", ")} is not answering yet; its documents are unknown and are kept if it answers.`
          : ""}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <ActionButton
          tone="commit"
          label={`close ${closing} Revit${closing === 1 ? "" : "s"} and update`}
          reason={consent.refusal ?? `pe-revit update apply ${plan.planId}`}
          disabled={consent.refusal !== null}
          busy={consent.pending}
          onClick={() => void consent.consent()}
        />
        {recheck}
      </span>
      {consent.refusal && blockers.length ? (
        <span data-tone="caution">Consent waits for the blocker above.</span>
      ) : null}
      {consent.error ? <OutcomeLine kind="refused" label={consent.error.message} /> : null}
      <Receipt machine={machine} gap={gap} />
    </div>
  );
}
