import { useEffect, useState } from "react";
import type { RouteStatePatch, ScheduleGridDocument } from "@pe/agent-contracts";
import type { CellWire } from "#/components/work/band";
import { Button } from "@pe/kit/lang/button";
import { staleAnswer } from "./columns";

const values = (n: number) => `${n} changed value${n === 1 ? "" : "s"}`;

/**
 * Ask A: the aggregate over the edit cells Revit moved under (each cell answers on its own row
 * in the review list's "changed in Revit" tab). "Overwrite N changed values" writes every cell's accept
 * in one Work write, then pushes; "Keep Revit's N values" writes every deny. A cell with a Pea
 * suggestion beside it is contested: skipped and counted. The same node draws on the band and on the
 * push verb's refusal flag.
 */
export function StaleResolve({
  doc,
  write,
  revision,
  push,
  unread,
  readAgain,
}: {
  doc: ScheduleGridDocument | null;
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
  const stale = (doc?.basis?.stale ?? []).filter((s) => cells[s.key]?.edit != null);
  if (!stale.length)
    return unread ? (
      <div className="flex items-baseline gap-2 t-prose" data-slot="stale-resolve">
        <span className="text-ink-2">
          {unread} refused as changed in Revit; the readback failed, so what Revit holds is unread
        </span>
        <Button kind="framed" label="read again" onClick={() => void readAgain()}>
          read again
        </Button>
      </div>
    ) : null;
  const contested = stale.filter((s) => cells[s.key]!.suggestion != null);
  const ready = stale.filter((s) => cells[s.key]!.suggestion == null);
  const edit = Object.values(cells).filter((c) => c.edit != null).length;
  // ponytail: push has no per-cell subset (NEEDS-CONTRACT), so the overwrite pushes exactly the
  // stale cells only while nothing else is edit; otherwise it says so and waits.
  const others = edit - stale.length;
  const answer = (kind: "take" | "unsuggest") =>
    write(
      ready.flatMap((s): RouteStatePatch[] => staleAnswer(s.key, cells[s.key]!, kind)),
      revision ?? undefined,
    );
  // The push admits the Work revision the page holds, so it waits for the re-stage's revision.
  const overwrite = async () => {
    const from = revision;
    if (!(await answer("take"))) setArmed(from);
  };
  const n = ready.length;
  return (
    <div className="flex flex-col gap-1 t-prose" data-slot="stale-resolve">
      {n ? (
        <span className="flex flex-wrap items-baseline gap-2">
          <Button
            kind="framed"
            label={`Overwrite ${values(n)}`}
            refusal={
              others > 0
                ? `${others} other edit cell${others === 1 ? "" : "s"} would push too; push or drop ${others === 1 ? "it" : "them"} first.`
                : null
            }
            reason={
              others > 0
                ? `${others} other edit cell${others === 1 ? "" : "s"} would push too; push or drop ${others === 1 ? "it" : "them"} first`
                : "Stage yours again over what Revit holds now, then push exactly these cells."
            }
            onClick={() => void overwrite()}
          >
            Overwrite {values(n)}
          </Button>
          <Button
            kind="framed"
            label={`Keep Revit's ${n} value${n === 1 ? "" : "s"}`}
            reason="Unstage each; Revit's value stands. Nothing is pushed."
            onClick={() => void answer("unsuggest")}
          >
            Keep Revit's {n} value{n === 1 ? "" : "s"}
          </Button>
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
