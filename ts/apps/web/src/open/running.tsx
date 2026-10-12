/**
 * The Running list: one block per Revit on this machine, as the SDK census reports it. Year,
 * name (or "started from the Revit icon"), the exact pid, custody and phase from the SDK row,
 * its shape as cells, the documents it holds, and its verbs.
 */
import type { MachineSession } from "@pe/agent-contracts";

import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { PidChip, ShapeCells } from "#/components/lang/process";
import { custodyOf, keyOf, nameOf, phaseOf, pidOf, PHASE_TONE } from "#/machine/session";
import { RevitControls, type WorkBasis } from "#/open/lifecycle";

const CUSTODY_SAYS = {
  controlled: "pe-revit holds its receipt: full lifecycle",
  observed: "no receipt yet: read by pid; the first open or stop adopts it",
};

export function RunningBlock({
  session,
  basis,
  refusal,
  onHere,
}: {
  session: MachineSession;
  basis: WorkBasis | null;
  refusal: string | null;
  onHere: () => void;
}) {
  const row = session.row;
  const phase = phaseOf(row);
  const custody = custodyOf(row);
  const pid = pidOf(row);
  return (
    <section
      className="hairline-t flex flex-col gap-1 py-1.5"
      aria-label={`Revit ${row.year} ${nameOf(row)}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="face-mono font-semibold text-ink">{row.year}</span>
        <span className={row.case === "observed-active" ? "text-ink" : "face-mono text-ink"}>
          {nameOf(row)}
        </span>
        {pid ? <PidChip pid={pid} /> : null}
        <span className="text-ink-2" title={CUSTODY_SAYS[custody]}>
          {custody}
        </span>
        <span className="ml-auto" data-tone={PHASE_TONE[phase]}>
          {phase}
        </span>
        {row.case === "controlled-active" && row.dialogs ? (
          <span data-tone="caution">dialog open</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <ShapeCells shape={row.shape} />
        <span className="ml-auto">
          <RevitControls session={session} basis={basis} refusal={refusal} onHere={onHere} />
        </span>
      </div>
      <div className="flex flex-col pl-3" aria-label="documents">
        {session.documents === null ? (
          <span className="text-ink-2">
            {session.documentsLeg.error
              ? `Documents unread: ${session.documentsLeg.error}`
              : "Documents unknown until it answers."}
          </span>
        ) : session.documents.length === 0 ? (
          <span className="text-ink-2">No document open.</span>
        ) : (
          session.documents.map((document) => (
            <span key={document.openId ?? document.path} className="flex items-center gap-2">
              <span className="w-2 face-mono text-ink-2">{document.isActive ? "▸" : ""}</span>
              <span
                className={document.isModified ? "font-semibold text-ink" : "text-ink"}
                title={`${document.path ?? ""}${document.isModified ? " · unsaved work" : ""}`}
              >
                {document.title ?? document.path}
              </span>
              <span className="ml-auto text-ink-2">
                {document.persistence === null
                  ? "persistence unknown"
                  : document.persistence === "cloud"
                    ? "cloud"
                    : "local"}
                {document.isModified ? " · unsaved" : ""}
              </span>
            </span>
          ))
        )}
      </div>
    </section>
  );
}

export function RunningList({
  sessions,
  loading,
  basis,
  refusal,
  onHere,
}: {
  sessions: readonly MachineSession[] | null;
  loading: boolean;
  basis: WorkBasis | null;
  refusal: string | null;
  onHere: (session: MachineSession) => void;
}) {
  if (sessions === null)
    return loading ? (
      <OutcomeLine kind="busy" label="reading the Revit census" />
    ) : (
      <OutcomeLine kind="error" label="the Revit census has not been read" />
    );
  if (!sessions.length)
    return (
      <EmptyState story="scope" exit="start one with the launcher above">
        no Revit is running
      </EmptyState>
    );
  return (
    <div className="flex flex-col">
      {sessions.map((session) => (
        <RunningBlock
          key={keyOf(session)}
          session={session}
          basis={basis}
          refusal={refusal}
          onHere={() => onHere(session)}
        />
      ))}
    </div>
  );
}
