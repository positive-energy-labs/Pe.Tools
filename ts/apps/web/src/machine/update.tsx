/**
 * The Update group: the plan in one sentence, each blocker with the Revit that holds it, consent
 * bound to this plan's id and refused while a blocker stands, Recheck, and the receipt's legs.
 * While the host is gone the strip says the honest gap: the last confirmed leg, then
 * "disconnected"; the successor host reads the receipt and the strip resumes (ruling 6).
 */
import type { Machine, Reading } from "@pe/agent-contracts";

import { Button } from "@pe/kit/lang/button";
import { LegStrip } from "#/components/lang/leg-strip";
import { OutcomeLine } from "#/components/lang/outcome";
import { PidChip } from "#/components/lang/process";
import { SwitchRow } from "#/components/lang/switch-row";
import { dirty, useAction } from "#/readings";
import { recheckUpdate } from "#/host/install";
import { hostFetch } from "#/host/runtime";

import { blockersOf, disconnected, hhmm, legWords, machineOf } from "./model";
import { updateStatus } from "./update-state";
import { SEED_REFUSAL, useUpdateConsent } from "./use-machine";
import { TooltipHint } from "@pe/kit/lang/tooltip";

const mb = (bytes: number) => `${Math.round(bytes / 1_048_576)} MB`;

async function setAutomaticUpdates(enabled: boolean): Promise<void> {
  const response = await hostFetch("/host/update/automatic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw Error(body?.error ?? `Switch refused (${response.status}).`);
}

/** The automatic-update off switch: one instrument, drawn in the Update group and on its card. */
export function AutomaticUpdates({
  reading,
  fixture,
}: {
  reading: Reading<Machine>;
  fixture: boolean;
}) {
  const machine = machineOf(reading);
  const toggle = useAction<boolean, void>(async (enabled) => {
    try {
      await setAutomaticUpdates(enabled);
    } finally {
      dirty({ kind: "machine" });
    }
  });
  if (!machine) return null;
  return (
    <>
      <SwitchRow
        label="Update automatically"
        says="Installs a new version once no Revit has been open for two minutes and Pea is idle"
        checked={machine.update.automatic}
        onCheckedChange={(enabled) => toggle.mutate(enabled)}
        refusal={
          fixture ? SEED_REFUSAL : disconnected(reading) ? "The host is disconnected." : null
        }
      />
      {toggle.error ? <OutcomeLine kind="refused" label={toggle.error.message} /> : null}
    </>
  );
}

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
        <OutcomeLine
          kind="refused"
          label={`${receipt?.state === "failed" ? "Update failed" : "Receipt read failed"}: ${receiptLeg.error}`}
        />
      ) : null}
      {restorationFailed ? (
        <span data-tone="caution">
          Updated. Some documents or the app did not reopen; reopen them from Open.
        </span>
      ) : null}
    </div>
  );
}

export function UpdateGroup({
  reading,
  fixture,
  checking = false,
}: {
  reading: Reading<Machine>;
  fixture: boolean;
  /** A recheck is in flight somewhere this group cannot see (a specimen draws it). */
  checking?: boolean;
}) {
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
  const status = updateStatus(machine, check.isPending || checking);
  const recheck = (
    <>
      <Button
        label="recheck"
        kind="framed"
        reason={
          fixture ? SEED_REFUSAL : "read the update feed again and re-plan against every Revit"
        }
        refusal={
          fixture || gap
            ? fixture
              ? SEED_REFUSAL
              : "read the update feed again and re-plan against every Revit"
            : null
        }
        busy={check.isPending}
        onClick={() => check.mutate()}
      >
        recheck
      </Button>
      {check.error ? <OutcomeLine kind="refused" label={check.error.message} /> : null}
    </>
  );
  if (status.state === "idle" || status.state === "checking" || status.state === "failed") {
    // Nothing waits on this person: up to date, unread, a check in flight, or a failure to read.
    const plan = machine.update.plan;
    return (
      <div className="flex flex-col gap-1" aria-label={`update ${status.state}`}>
        <span className="flex items-center gap-2">
          {status.state === "checking" ? (
            <OutcomeLine kind="busy" label="Reading the update feed" />
          ) : status.state === "failed" ? (
            // An apply's reason is the receipt's own line below; a check has no receipt to say it.
            <span data-tone={status.during === "check" ? "caution" : "alarm"}>
              {status.during === "check"
                ? `Update check failed: ${status.message}`
                : "Update failed. Recheck to plan again."}
            </span>
          ) : status.state === "idle" && plan ? (
            <>
              <span>
                Up to date <span className="face-mono">{plan.current}</span>
              </span>
              <span className="text-ink-2">checked {hhmm(plan.observedAtUtc)}</span>
            </>
          ) : status.state === "idle" ? (
            <span className="text-ink-2">The update feed has not been read yet.</span>
          ) : null}
          <span className="ml-auto">{recheck}</span>
        </span>
        {status.state === "idle" && status.checkError ? (
          <span data-tone="caution">Update check failed: {status.checkError}</span>
        ) : null}
        <AutomaticUpdates reading={reading} fixture={fixture} />
        <Receipt machine={machine} gap={gap} />
      </div>
    );
  }
  if (status.state === "downloading" || status.state === "applying")
    return (
      <div className="flex flex-col gap-1" aria-label={`update ${status.state}`}>
        <span className="flex items-center gap-2">
          <OutcomeLine
            kind="busy"
            label={
              status.state === "downloading"
                ? `Downloading ${status.to ?? "the update"}`
                : legWords(status.leg, status.to)
            }
            says={machine.update.receipt?.legs.at(-1)?.detail ?? undefined}
          />
          <span className="ml-auto">{recheck}</span>
        </span>
        <AutomaticUpdates reading={reading} fixture={fixture} />
        <Receipt machine={machine} gap={gap} />
      </div>
    );
  const plan = status.plan;
  const blockers = blockersOf(plan);
  const blockedByRevit = blockers.some(({ revit }) => revit !== null);
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
        <TooltipHint
          content={`consent binds to ${plan.planId}; a changed Revit re-plans and asks again`}
        >
          <span className="ml-auto face-mono text-ink-2">{plan.planId.slice(-9)}</span>
        </TooltipHint>
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
        {blockedByRevit ? (
          "Revit is open. Update saves your work, restarts Revit and reopens your documents."
        ) : (
          <>
            Closes {closing} Revit{closing === 1 ? "" : "s"} keeping their work, installs, then
            reopens {reopening} document{reopening === 1 ? "" : "s"}.
            {unknown.length
              ? ` Revit ${unknown.map((revit) => revit.year).join(", ")} is not answering yet; its documents are unknown and are kept if it answers.`
              : ""}
          </>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Button
          kind="commit"
          label={
            blockedByRevit
              ? "Update"
              : `close ${closing} Revit${closing === 1 ? "" : "s"} and update`
          }
          reason={consent.refusal ?? `pe-revit update apply ${plan.planId}`}
          refusal={consent.refusal}
          busy={consent.pending}
          onClick={() => void consent.consent()}
        >
          {blockedByRevit
            ? "Update"
            : `close ${closing} Revit${closing === 1 ? "" : "s"} and update`}
        </Button>
        {recheck}
      </span>
      {consent.refusal && blockers.length ? (
        <span data-tone="caution">Consent waits for the blocker above.</span>
      ) : null}
      {consent.error ? <OutcomeLine kind="refused" label={consent.error.message} /> : null}
      <AutomaticUpdates reading={reading} fixture={fixture} />
      <Receipt machine={machine} gap={gap} />
    </div>
  );
}
