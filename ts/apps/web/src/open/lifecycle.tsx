/**
 * The per-Revit lifecycle, one hook for the Running desk and the machine drawer: `useLifecycle`
 * returns the verbs (hr only when the SDK says `shape.reload === "hot"`, and Stop) and the
 * `ArmingStrip` the armed verb opens, as two slots a `SessionRow` or `SessionCard` places. Every
 * verb is an `instances.*` semantic action; the SDK resolves the Revit from the selection (pid for
 * an icon-started Revit, id otherwise). Nothing is edit first (ADR 0016).
 *
 * Stop always passes `--unsaved keep` for a lay user; discard is offered only for a checkout
 * session (host ledger 2026-10-09 ruling 9). hr restarts and discards, so it arms first too.
 */
import { useState, type ReactNode } from "react";
import { Square } from "lucide-react";
import { instancesActions, nativeProcessSchema, type MachineSession } from "@pe/agent-contracts";

import { ArmingStrip } from "@pe/kit/lang/arming-strip";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine, type OutcomeKind } from "@pe/kit/lang/outcome";
import { PidChip } from "#/components/lang/process";
import type { SessionFacts } from "#/components/lang/session";
import {
  custodyOf,
  executionRefusal,
  nameOf,
  phaseOf,
  pidOf,
  processOf,
  selectionOf,
  selectorWords,
  unsavedOf,
  PHASE_TONE,
} from "#/machine/session";
import { useAction } from "#/readings";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

/** The kit's reading of one census row, derived here once for both densities. */
export const factsOf = (session: MachineSession): SessionFacts => {
  const row = session.row;
  const phase = phaseOf(row);
  return {
    year: row.year,
    name: row.case === "observed-active" ? null : nameOf(row),
    pid: pidOf(row),
    phase,
    phaseTone: PHASE_TONE[phase],
    custody: custodyOf(row),
    dialog: row.case === "controlled-active" && Boolean(row.dialogs),
  };
};

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
  return await runSemanticAction(key, input, undefined, {}, "", undefined, 30_000);
}

type Armed = "stop" | "hr" | null;

export function useLifecycle({
  session,
  refusal,
  hr = true,
}: {
  session: MachineSession;
  /** Present, every verb refuses with it (a fixture). */
  refusal?: string | null;
  /** False where hr is not offered (the drawer and the tray keep it on the Running list). */
  hr?: boolean;
}): { verbs: ReactNode; strip: ReactNode } {
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
          label: `${command} ${receipt.state}`,
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
  /** One sentence per verb: its reason when it can run, its refusal when it cannot. */
  const gate = (says: string, inert = false) => ({
    reason: blocked ?? says,
    refusal: blocked ?? (inert ? says : null),
  });
  const selector = selectorWords(row);
  const stopLabel = phase === "unresponsive" ? "force stop" : "stop";
  const pid = pidOf(row);

  const verbs = (
    <>
      {hr && row.shape.reload === "hot" ? (
        <Button
          label="hr"
          kind="framed"
          pressed={armed === "hr"}
          {...gate(
            `pe-revit session hr ${selector} --restart: restart this development Revit and reopen its documents; unsaved edits are discarded`,
            busy,
          )}
          onClick={() => setArmed(armed === "hr" ? null : "hr")}
        >
          hr
        </Button>
      ) : null}
      <Button
        label={stopLabel}
        kind="framed"
        pressed={armed === "stop"}
        busy={busy && armed === "stop"}
        {...gate(`pe-revit session stop ${selector}`, busy)}
        onClick={() => setArmed(armed === "stop" ? null : "stop")}
      >
        {stopLabel}
      </Button>
    </>
  );

  const said =
    session.documents === null
      ? "Its documents are unknown until it answers."
      : unsaved.length
        ? `Unsaved: ${unsaved.map((document) => document.title ?? document.path).join(", ")}.`
        : "Nothing is unsaved.";
  const target = `Revit ${row.year} ${nameOf(row)}`;
  const facts = pid ? <PidChip pid={pid} /> : null;
  const strip = (
    <>
      {armed === "stop" ? (
        <ArmingStrip
          verb={`${stopLabel}, keep work`}
          target={target}
          facts={facts}
          icon={Square}
          says={`${said} Stop keeps work: unsaved documents are saved first, a cloud model syncs first, and stop refuses if it cannot.${
            row.case === "observed-active" ? " Stopping adopts this Revit by its pid." : ""
          }`}
          state={{ phase: "arming" }}
          busy={busy}
          refusal={blocked}
          onCommit={() => run("stop", "keep")}
          onCancel={() => setArmed(null)}
          alternatives={
            checkout ? (
              <Button
                label="stop, discard edits"
                kind="framed"
                {...gate(
                  `pe-revit session stop ${selector} --unsaved discard; offered only for a checkout session`,
                  busy,
                )}
                onClick={() => run("stop", "discard")}
              >
                stop, discard edits
              </Button>
            ) : null
          }
        />
      ) : armed === "hr" ? (
        <ArmingStrip
          verb="restart"
          target={target}
          facts={facts}
          says={
            <span data-tone="caution">
              {said} hr restarts this Revit and reopens its documents; unsaved edits are discarded.
            </span>
          }
          state={{ phase: "arming" }}
          busy={busy}
          refusal={blocked}
          onCommit={() => run("restart")}
          onCancel={() => setArmed(null)}
        />
      ) : null}
      {outcome ? <OutcomeLine kind={outcome.kind} label={outcome.label} /> : null}
    </>
  );
  return { verbs, strip };
}
