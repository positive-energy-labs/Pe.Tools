/**
 * The per-Revit lifecycle verbs, one component for the Running list and the machine drawer: hr
 * (only when the SDK says `shape.reload === "hot"`), Open here, and Stop. Every verb is an
 * `instances.*` semantic action bound to the instances Work revision; the SDK resolves the Revit
 * from the selection (pid for an icon-started Revit, id otherwise).
 *
 * Stop always passes `--unsaved keep` for a lay user; discard is offered only for a checkout
 * session (host ledger 2026-10-09 ruling 9). hr restarts and discards, so it arms first too.
 */
import { useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  instancesActions,
  instancesRouteState,
  nativeProcessSchema,
  type InstancesActionKey,
  type MachineSession,
  type WorkKey,
} from "@pe/agent-contracts";

import { ActionButton } from "#/components/lang/action-button";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { PidChip } from "#/components/lang/process";
import {
  phaseOf,
  pidOf,
  processOf,
  selectionOf,
  selectorWords,
  unsavedOf,
} from "#/machine/session";
import { previousOf, useAction } from "#/readings";
import { docAtom } from "#/route/route-work";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

export interface WorkBasis {
  readonly key: WorkKey;
  readonly revision: number;
}

export const INSTANCES_WORK: WorkKey = {
  binding: "workspace",
  route: "instances",
  target: null,
  work: "instances",
};

/** The instances Work revision, for a shell that holds no route handle (the drawer, the tray). */
export function useInstancesBasis(enabled: boolean): WorkBasis | null {
  const atom = useMemo(() => docAtom(instancesRouteState, INSTANCES_WORK), []);
  const slice = previousOf(useAtomValue(atom));
  return enabled && slice && slice.revision !== null
    ? { key: INSTANCES_WORK, revision: slice.revision }
    : null;
}

type Command = "open" | "restart" | "stop";

/** One lifecycle action over one Revit incarnation, as a person. Resolves to its receipt. */
export async function runLifecycle(
  command: Command,
  session: MachineSession,
  basis: WorkBasis,
  unsaved?: "keep" | "discard",
) {
  const key: InstancesActionKey = `instances.${command}`;
  const process = processOf(session.row);
  if (!process) throw Error("This Revit has no process yet; wait until it is launched.");
  const input = instancesActions[key].input.parse({
    workspaceId: basis.key.work,
    session: { selection: selectionOf(session.row), process: nativeProcessSchema.parse(process) },
    ...(command === "stop" ? { force: phaseOf(session.row) === "unresponsive", unsaved } : {}),
  });
  return await runSemanticAction(
    key,
    input,
    undefined,
    { work: basis },
    "human",
    "",
    command === "open" ? crypto.randomUUID() : undefined,
    30_000,
  );
}

type Armed = "stop" | "hr" | null;

export function RevitControls({
  session,
  basis,
  refusal,
  onHere,
  hr = true,
}: {
  session: MachineSession;
  basis: WorkBasis | null;
  /** False where hr is not offered (the drawer and the tray keep it on the Running list). */
  hr?: boolean;
  /** Present, every verb refuses with it (a fixture, no Work yet). */
  refusal?: string | null;
  /** Open here: make this Revit the launcher's target. Absent outside the Open route. */
  onHere?: () => void;
}) {
  const [armed, setArmed] = useState<Armed>(null);
  const [outcome, setOutcome] = useState<{ kind: OutcomeKind; label: string } | null>(null);
  const row = session.row;
  const phase = phaseOf(row);
  const checkout = row.shape.payload === "checkout";
  const blocked = refusal ?? (basis ? null : "Reading the instances Work before any verb runs.");
  const unsaved = unsavedOf(session);
  const action = useAction(
    async ({ command, policy }: { command: Command; policy?: "keep" | "discard" }) => {
      if (!basis) return;
      try {
        const receipt = await runLifecycle(command, session, basis, policy);
        setOutcome({
          kind: receipt.state === "succeeded" ? "receipt" : "advisory",
          label: `${command} ${receipt.state} · action ${receipt.id}`,
        });
      } catch (caught) {
        setOutcome({ kind: "refused", label: `${command} refused: ${String(caught)}` });
      } finally {
        setArmed(null);
      }
    },
  );
  const busy = action.isPending;
  const run = (command: Command, policy?: "keep" | "discard") => action.mutate({ command, policy });
  const said =
    session.documents === null
      ? "Its documents are unknown until it answers."
      : unsaved.length
        ? `Unsaved: ${unsaved.map((document) => document.title ?? document.path).join(", ")}.`
        : "Nothing is unsaved.";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap items-center justify-end gap-1">
        {hr && row.shape.reload === "hot" ? (
          <ActionButton
            label="hr"
            reason={
              blocked ??
              `pe-revit session hr ${selectorWords(row)} --restart: restart this development Revit and reopen its documents; unsaved edits are discarded`
            }
            disabled={blocked !== null || busy}
            onClick={() => setArmed(armed === "hr" ? null : "hr")}
          />
        ) : null}
        {onHere ? (
          <ActionButton
            label="open here"
            reason={
              phase === "ready"
                ? "make this Revit the launcher's target"
                : `this Revit is ${phase}; it opens nothing until it answers`
            }
            disabled={phase !== "ready"}
            onClick={onHere}
          />
        ) : null}
        <ActionButton
          label={phase === "unresponsive" ? "force stop" : "stop"}
          reason={blocked ?? `pe-revit session stop ${selectorWords(row)}`}
          disabled={blocked !== null || busy}
          busy={busy && armed === "stop"}
          onClick={() => setArmed(armed === "stop" ? null : "stop")}
        />
      </span>
      {armed ? (
        <div data-surface="recess" className="flex flex-col gap-1 px-2 py-1.5">
          <span className="flex flex-wrap items-center gap-1.5">
            {armed === "stop" ? "Stop" : "Restart"} Revit {row.year}
            {pidOf(row) ? <PidChip pid={pidOf(row)!} /> : null}
            <span className="text-ink-2">{said}</span>
          </span>
          {armed === "stop" ? (
            <span className="text-ink-2">
              Stop keeps work: unsaved documents are saved first, a cloud model syncs first, and
              stop refuses if it cannot.
              {row.case === "observed-active" ? " Stopping adopts this Revit by its pid." : ""}
            </span>
          ) : (
            <span data-tone="caution">hr restarts this Revit; unsaved edits are discarded.</span>
          )}
          <span className="flex flex-wrap items-center gap-1.5">
            {armed === "stop" ? (
              <>
                <ActionButton
                  tone="commit"
                  label="stop, keep work"
                  reason={`pe-revit session stop ${selectorWords(row)} --unsaved keep`}
                  busy={busy}
                  onClick={() => run("stop", "keep")}
                />
                {checkout ? (
                  <ActionButton
                    label="stop, discard edits"
                    reason={`pe-revit session stop ${selectorWords(row)} --unsaved discard; offered only for a checkout session`}
                    disabled={busy}
                    onClick={() => run("stop", "discard")}
                  />
                ) : null}
              </>
            ) : (
              <ActionButton
                tone="commit"
                label="restart"
                reason={`pe-revit session hr ${selectorWords(row)} --restart`}
                busy={busy}
                onClick={() => run("restart")}
              />
            )}
            <ActionButton label="cancel" reason="disarm" onClick={() => setArmed(null)} />
          </span>
        </div>
      ) : null}
      {outcome ? <OutcomeLine kind={outcome.kind} label={outcome.label} /> : null}
    </div>
  );
}
