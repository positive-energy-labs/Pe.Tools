/**
 * The per-Revit lifecycle verbs, one component for the Running list and the machine drawer: hr
 * (only when the SDK says `shape.reload === "hot"`), Open here, and Stop. Every verb is an
 * `instances.*` semantic action; the SDK resolves the Revit from the selection (pid for an
 * icon-started Revit, id otherwise).
 *
 * Stop always passes `--unsaved keep` for a lay user; discard is offered only for a checkout
 * session (host ledger 2026-10-09 ruling 9). hr restarts and discards, so it arms first too.
 */
import { useState } from "react";
import { instancesActions, nativeProcessSchema, type MachineSession } from "@pe/agent-contracts";

import { Button } from "#/components/lang/button";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { PidChip } from "#/components/lang/process";
import {
  executionRefusal,
  phaseOf,
  pidOf,
  processOf,
  selectionOf,
  selectorWords,
  unsavedOf,
} from "#/machine/session";
import { useAction } from "#/readings";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

type Command = "restart" | "stop";

/** One lifecycle action over one Revit incarnation, as a person. Resolves to its receipt. */
export async function runLifecycle(
  command: Command,
  session: MachineSession,
  unsaved?: "keep" | "discard",
) {
  const refusal = executionRefusal(session.row);
  if (refusal) throw Error(refusal);
  const key = `instances.${command}` as const;
  const process = processOf(session.row);
  if (!process) throw Error("This Revit has no process yet; wait until it is launched.");
  const input = instancesActions[key].input.parse({
    session: { selection: selectionOf(session.row), process: nativeProcessSchema.parse(process) },
    ...(command === "stop" ? { force: phaseOf(session.row) === "unresponsive", unsaved } : {}),
  });
  return await runSemanticAction(key, input, undefined, {}, "human", "", undefined, 30_000);
}

type Armed = "stop" | "hr" | null;

export function RevitControls({
  session,
  refusal,
  onHere,
  hr = true,
}: {
  session: MachineSession;
  /** False where hr is not offered (the drawer and the tray keep it on the Running list). */
  hr?: boolean;
  /** Present, every verb refuses with it (a fixture). */
  refusal?: string | null;
  /** Open here: make this Revit the launcher's target. Absent outside the Open route. */
  onHere?: () => void;
}) {
  const [armed, setArmed] = useState<Armed>(null);
  const [outcome, setOutcome] = useState<{ kind: OutcomeKind; label: string } | null>(null);
  const row = session.row;
  const phase = phaseOf(row);
  const checkout = row.shape.payload === "checkout";
  const ownershipRefusal = executionRefusal(row);
  const blocked = refusal ?? ownershipRefusal;
  const unsaved = unsavedOf(session);
  const action = useAction(
    async ({ command, policy }: { command: Command; policy?: "keep" | "discard" }) => {
      try {
        const receipt = await runLifecycle(command, session, policy);
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
          <Button
            label="hr"
            kind="framed"
            reason={
              blocked ??
              `pe-revit session hr ${selectorWords(row)} --restart: restart this development Revit and reopen its documents; unsaved edits are discarded`
            }
            refusal={
              blocked !== null || busy
                ? (blocked ??
                  `pe-revit session hr ${selectorWords(row)} --restart: restart this development Revit and reopen its documents; unsaved edits are discarded`)
                : null
            }
            onClick={() => setArmed(armed === "hr" ? null : "hr")}
          >
            hr
          </Button>
        ) : null}
        {onHere ? (
          <Button
            label="open here"
            kind="framed"
            reason={
              ownershipRefusal ??
              (phase === "ready"
                ? "make this Revit the launcher's target"
                : `this Revit is ${phase}; it opens nothing until it answers`)
            }
            refusal={
              ownershipRefusal !== null || phase !== "ready"
                ? (ownershipRefusal ??
                  (phase === "ready"
                    ? "make this Revit the launcher's target"
                    : `this Revit is ${phase}; it opens nothing until it answers`))
                : null
            }
            onClick={onHere}
          >
            open here
          </Button>
        ) : null}
        <Button
          label={phase === "unresponsive" ? "force stop" : "stop"}
          kind="framed"
          reason={blocked ?? `pe-revit session stop ${selectorWords(row)}`}
          refusal={
            blocked !== null || busy
              ? (blocked ?? `pe-revit session stop ${selectorWords(row)}`)
              : null
          }
          busy={busy && armed === "stop"}
          onClick={() => setArmed(armed === "stop" ? null : "stop")}
        >
          {phase === "unresponsive" ? "force stop" : "stop"}
        </Button>
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
                <Button
                  kind="commit"
                  label="stop, keep work"
                  reason={`pe-revit session stop ${selectorWords(row)} --unsaved keep`}
                  busy={busy}
                  refusal={
                    blocked !== null
                      ? `pe-revit session stop ${selectorWords(row)} --unsaved keep`
                      : null
                  }
                  onClick={() => run("stop", "keep")}
                >
                  stop, keep work
                </Button>
                {checkout ? (
                  <Button
                    label="stop, discard edits"
                    kind="framed"
                    reason={`pe-revit session stop ${selectorWords(row)} --unsaved discard; offered only for a checkout session`}
                    refusal={
                      blocked !== null || busy
                        ? `pe-revit session stop ${selectorWords(row)} --unsaved discard; offered only for a checkout session`
                        : null
                    }
                    onClick={() => run("stop", "discard")}
                  >
                    stop, discard edits
                  </Button>
                ) : null}
              </>
            ) : (
              <Button
                kind="commit"
                label="restart"
                reason={`pe-revit session hr ${selectorWords(row)} --restart`}
                busy={busy}
                refusal={
                  blocked !== null ? `pe-revit session hr ${selectorWords(row)} --restart` : null
                }
                onClick={() => run("restart")}
              >
                restart
              </Button>
            )}
            <Button label="cancel" kind="framed" reason="disarm" onClick={() => setArmed(null)}>
              cancel
            </Button>
          </span>
        </div>
      ) : null}
      {outcome ? <OutcomeLine kind={outcome.kind} label={outcome.label} /> : null}
    </div>
  );
}
