import { DownloadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Machine } from "@pe/agent-contracts";
import { dirty, useAction, useReading } from "#/readings";
import { acknowledgeUpdate } from "../host/install";
import { ActionButton } from "./lang/action-button";
import { FactChip } from "./lang/chip";
import { OutcomeLine } from "./lang/outcome";

/**
 * The machine's update (host ledger 2026-10-08), read once per app open. Quiet (no Revit, or every
 * one idle with nothing unsaved): apply without asking. Otherwise ask on every open; a dismissal is
 * not remembered. Apply closes every Revit keeping its work, installs, then reopens the documents
 * and this app.
 *
 * Ruled 2026-09-10 (Q3): this is a fact about the MACHINE the app runs on, not about one route,
 * so it lives at the document root and the route shell keeps only the lamp.
 */
export function UpdateButton() {
  const reading = useReading<Machine>({ kind: "machine" });
  const machine =
    reading.state === "ready"
      ? reading.observation
      : "previous" in reading
        ? reading.previous
        : undefined;
  const plan = machine?.update.plan;
  const receipt = machine?.update.receipt;
  const [requestId, setRequestId] = useState<string | null>(null);
  const update = useAction(async () => {
    if (!plan?.planId) throw new Error("Read an update plan before applying it.");
    const admitted = await acknowledgeUpdate(plan.planId);
    dirty({ kind: "machine" });
    return admitted;
  }, setRequestId);
  const previousSettled = receipt && ["ok", "failed", "refused"].includes(receipt.state);
  const offered =
    machine?.host?.payload === "installed" &&
    plan?.available === true &&
    requestId === null &&
    machine.update.admittedPlanId !== plan.planId &&
    (!machine.update.requestId || previousSettled);
  const quiet =
    offered && plan?.quiet === true && reading.state === "ready" && !machine?.update.planLeg.error;
  const started = useRef(false);
  useEffect(() => {
    if (!quiet || started.current) return;
    started.current = true;
    update.mutate(undefined);
  }, [quiet, update]);
  const busy = (plan?.revits ?? []).filter(
    (revit) => !revit.idle || revit.unknown || revit.documents.some((doc) => doc.isModified),
  );
  return (
    <div className="flex items-center gap-2">
      {machine?.host?.version && (
        <FactChip title="the release installed on this machine">v{machine.host.version}</FactChip>
      )}
      {machine?.update.planLeg.error && (
        <OutcomeLine kind="advisory" label="update check unavailable" />
      )}
      {(requestId || machine?.update.requestId) && (
        <OutcomeLine
          kind={
            receipt?.state === "ok"
              ? "receipt"
              : receipt?.state === "failed" || receipt?.state === "refused"
                ? "error"
                : "advisory"
          }
          label={receipt ? `update ${receipt.state}` : "update admitted; receipt pending"}
          says={
            reading.state === "stale"
              ? "Host disconnected; progress is not observed"
              : (receipt?.legs.at(-1)?.detail ?? undefined)
          }
        />
      )}
      {update.isPending && (
        <OutcomeLine
          kind="busy"
          label={`updating to ${plan?.latest}`}
          says="Revit closes with its work saved, then the app and your documents reopen"
        />
      )}
      {update.error && <OutcomeLine kind="error" label={update.error.message} />}
      {offered && !quiet && !update.isPending && (
        <>
          <OutcomeLine
            kind="advisory"
            label={`${plan?.latest} is ready`}
            says={busy
              .map((revit) => {
                const modified = revit.documents.filter((doc) => doc.isModified);
                return revit.unknown
                  ? `Revit ${revit.year} could not be inspected`
                  : modified.length
                    ? `Revit ${revit.year} saves ${modified.map((doc) => doc.title ?? doc.path ?? "untitled").join(", ")} first`
                    : `Revit ${revit.year} is busy`;
              })
              .concat((plan?.blockers ?? []).map((blocker) => blocker.detail))
              .join("; ")}
          />
          <ActionButton
            tone="act"
            label="update"
            icon={DownloadCloud}
            onClick={() => update.mutate(undefined)}
            reason="Close every Revit (saving its work), install the new release, then reopen your documents and this app"
          />
        </>
      )}
    </div>
  );
}
