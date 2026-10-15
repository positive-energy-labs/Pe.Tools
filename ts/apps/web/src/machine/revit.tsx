/** Runtime census and repair controls. Open owns document selection and binding. */
import type { Machine, MachineSession } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { PidChip } from "#/components/lang/process";
import { useLifecycle } from "#/open/lifecycle";
import { useDestination } from "#/navigation/state";
import { BootstrapAlignment } from "./bootstrap";
import {
  custodyOf,
  executionRefusal,
  keyOf,
  nameOf,
  phaseOf,
  pidOf,
  processOf,
  PHASE_TONE,
} from "./session";

function SessionHealth({ session, refusal }: { session: MachineSession; refusal: string | null }) {
  const { verbs, strip } = useLifecycle({ session, refusal });
  const row = session.row;
  const phase = phaseOf(row);
  const pid = pidOf(row);
  const execution = executionRefusal(row);
  return (
    <section
      className="flex flex-col gap-1 hairline-b py-2"
      aria-label={`Revit ${row.year} ${nameOf(row)}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Revit {row.year}</span>
        <span className="face-mono">{nameOf(row)}</span>
        {pid && <PidChip pid={pid} />}
        <span data-tone={PHASE_TONE[phase]}>{phase}</span>
        <span className="text-ink-2">
          {custodyOf(row)} · {row.shape.payload}
        </span>
        <span className="ml-auto flex gap-1">{verbs}</span>
      </div>
      {row.case === "controlled-active" && row.dialogs && (
        <p data-tone="caution">
          Revit shows a dialog. Respond in that Revit window before running another action.
        </p>
      )}
      {execution && <p className="text-ink-2">{execution}</p>}
      {strip}
    </section>
  );
}

export function RevitGroup({
  machine,
  refusal,
  session,
}: {
  machine: Machine;
  refusal: string | null;
  session?: string;
}) {
  const go = useDestination();
  const sessions = machine.revit.sessions;
  const selected = session ? sessions?.filter((entry) => keyOf(entry) === session) : sessions;
  return (
    <div className="flex flex-col gap-2" aria-label="Revit runtime">
      <BootstrapAlignment machine={machine} refusal={refusal} />
      <Button label="Open documents and binding" onClick={() => go("/open")}>
        Open documents and binding
      </Button>
      {sessions === null ? (
        <p data-tone="caution">
          {machine.legs.sessions?.error ?? "The Revit census has not been read."}
        </p>
      ) : !selected?.length ? (
        <p className="text-ink-2">
          {session
            ? "The selected Revit incarnation is absent from this census."
            : "No Revit is running."}
        </p>
      ) : (
        selected.map((entry) => (
          <SessionHealth
            key={`${keyOf(entry)}:${processOf(entry.row)?.processStartUtc ?? "pending"}`}
            session={entry}
            refusal={refusal}
          />
        ))
      )}
    </div>
  );
}
