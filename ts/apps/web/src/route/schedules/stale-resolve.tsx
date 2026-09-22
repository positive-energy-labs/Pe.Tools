import { showScheduleCellValue } from "@pe/agent-contracts";
import { useEffect, useState } from "react";
import type { RouteStatePatch, ScheduleGridDocument } from "@pe/agent-contracts";
import type { CellWire } from "#/components/lang/band";
import { StateCell, cellFromTrichotomy } from "#/components/lang/cell";
import { Press } from "#/components/lang/press";
import { STALE_NOTE, scheduleTransitions, staleAnswer } from "./columns";

const values = (n: number) => `${n} changed value${n === 1 ? "" : "s"}`;

/**
 * Ask A: the staged cells Revit moved under, each drawn as its own stale cell (A · C · B) with its
 * accept/deny, and the aggregate over them. "Overwrite N changed values" writes every cell's accept
 * in one Work write, then pushes; "Keep Revit's N values" writes every deny. A cell with a Pea
 * proposal beside it is contested: skipped and counted. The same node draws on the band and on the
 * push verb's refusal flag.
 */
export function StaleResolve({
  doc,
  current,
  write,
  revision,
  push,
  unread,
  readAgain,
}: {
  doc: ScheduleGridDocument | null;
  /** C: what the basis reading says Revit holds at the key. */
  current: (key: string) => string | null;
  write: CellWire["write"];
  revision: number | null;
  push: () => Promise<unknown>;
  /** Cells a push refused as stale whose readback failed, so no C is drawn: read again first. */
  unread: number;
  readAgain: () => Promise<unknown>;
}) {
  const [armed, setArmed] = useState<number | null>(null);
  useEffect(() => {
    if (armed === null || revision === armed) return;
    setArmed(null);
    void push();
  }, [armed, revision, push]);
  const cells = doc?.cells ?? {};
  const stale = (doc?.basis?.stale ?? []).filter((s) => cells[s.key]?.staged != null);
  if (!stale.length)
    return unread ? (
      <div className="flex items-baseline gap-2 t-prose" data-slot="stale-resolve">
        <span className="text-ink-2">
          {unread} refused as changed in Revit; the readback failed, so what Revit holds is unread
        </span>
        <Press frame="line" tone="quiet" size="value" onClick={() => void readAgain()}>
          read again
        </Press>
      </div>
    ) : null;
  const wire: CellWire = { segment: "cells", write, revision };
  const contested = stale.filter((s) => cells[s.key]!.proposal != null);
  const ready = stale.filter((s) => cells[s.key]!.proposal == null);
  const staged = Object.values(cells).filter((c) => c.staged != null).length;
  // ponytail: push has no per-cell subset (NEEDS-CONTRACT), so the overwrite pushes exactly the
  // stale cells only while nothing else is staged; otherwise it says so and waits.
  const others = staged - stale.length;
  const answer = (kind: "accept" | "deny") =>
    write(
      ready.flatMap((s): RouteStatePatch[] => staleAnswer(s.key, cells[s.key]!, kind)),
      revision ?? undefined,
    );
  // The push admits the Work revision the page holds, so it waits for the re-stage's revision.
  const overwrite = async () => {
    const from = revision;
    if (!(await answer("accept"))) setArmed(from);
  };
  const n = ready.length;
  return (
    <div className="flex flex-col gap-1 t-prose" data-slot="stale-resolve">
      <ul aria-label="changed in Revit" className="flex flex-col">
        {stale.map((s) => {
          const cell = cells[s.key]!;
          return (
            <li key={s.key} className="flex items-baseline gap-2">
              <span className="face-mono text-ink-mute">{s.key}</span>
              <StateCell
                {...cellFromTrichotomy(cell, {
                  value: showScheduleCellValue(cell.staged!.value),
                  agree: "drift",
                  modelValue: current(s.key) ?? "",
                  reviewed: s.was,
                  note: STALE_NOTE,
                })}
                transitions={scheduleTransitions(wire, s.key, cell, stale)}
              />
            </li>
          );
        })}
      </ul>
      {n ? (
        <span className="flex flex-wrap items-baseline gap-2">
          <Press
            frame="line"
            tone="neutral"
            size="value"
            disabled={others > 0}
            title={
              others > 0
                ? `${others} other staged cell${others === 1 ? "" : "s"} would push too; push or drop ${others === 1 ? "it" : "them"} first`
                : "Stage yours again over what Revit holds now, then push exactly these cells."
            }
            onClick={() => void overwrite()}
          >
            Overwrite {values(n)}
          </Press>
          <Press
            frame="line"
            tone="quiet"
            size="value"
            title="Unstage each; Revit's value stands. Nothing is pushed."
            onClick={() => void answer("deny")}
          >
            Keep Revit's {n} value{n === 1 ? "" : "s"}
          </Press>
          {contested.length ? (
            <span className="text-ink-2">skipped {contested.length} (Pea proposed)</span>
          ) : null}
        </span>
      ) : (
        <span className="text-ink-2">skipped {contested.length} (Pea proposed)</span>
      )}
    </div>
  );
}
