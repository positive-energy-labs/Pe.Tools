/**
 * The Running desk: one `SessionCard` per Revit on this machine, as the SDK census reports it,
 * with its lifecycle verbs and arming strip from `useLifecycle`.
 */
import type { MachineSession } from "@pe/agent-contracts";

import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { SessionCard } from "#/components/lang/session";
import { keyOf } from "#/machine/session";
import { factsOf, useLifecycle, type WorkBasis } from "#/open/lifecycle";

export function RunningSession({
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
  const { verbs, strip } = useLifecycle({ session, basis, refusal, onHere });
  return (
    <SessionCard
      session={session}
      facts={factsOf(session)}
      anchor={keyOf(session)}
      verbs={verbs}
      strip={strip}
    />
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
    <div className="flex flex-col gap-2">
      {sessions.map((session) => (
        <RunningSession
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
