import { Button } from "@pe/kit/lang/button";
import { SubjectText } from "@pe/kit/lang/subject-text";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { useState } from "react";
import type { FittingGroup } from "./fitting-groups";

/*
 * Per-fitting loss readouts (ruling 2026-11-10: results, not inputs): what each pricing rule adds to
 * this fan's ESP, and its members on the walk. Read-only; the table a rule prices under is chosen on
 * /ducts (its Rules pane), so each group links there instead of staging /ducts Work from /fans.
 */
const inWg = (v: number | null) => (v == null ? "—" : v.toFixed(4));

function Group({ group, ductsHref }: { group: FittingGroup; ductsHref: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)_auto] items-center gap-x-2 gap-y-1 hairline-t pt-1"
      data-fitting-group={group.key} data-fitting-source={group.source}>
      <TooltipHint content={group.title}><span className="min-w-0 truncate">{group.title}</span></TooltipHint>
      <span className="face-mono text-right">{inWg(group.lossInWg)} in-wg</span>
      <a href={ductsHref} className="t-small text-ink-2">{group.table ?? "unpriced"} · on /ducts</a>
      <span className="col-span-3 flex min-w-0 items-center gap-2 t-small">
        <Button kind="quiet" label={`${open ? "Hide" : "Show"} the ${group.members.length} fittings`} onPress={() => setOpen(!open)}>
          {open ? "Hide" : "Show"} {group.members.length} on this fan
        </Button>
        <span className="min-w-0 truncate text-ink-2">{group.source} / {group.tableMeaning ?? group.reach}</span>
        {group.unpriced > 0 && <span data-tone="alarm">{group.unpriced} not priced</span>}
      </span>
      {open && group.members.map((m) => (
        <div key={m.key} className="contents" data-fitting={m.key}>
          <span className="min-w-0 truncate pl-4"><SubjectText text={m.subject} revit={m.ids} owner={`fitting:${m.key}`} /></span>
          <span className="face-mono text-right">{inWg(m.lossInWg)}</span>
          <TooltipHint content={m.note}><span className="t-small min-w-0 truncate text-ink-2">{m.note ?? ""}</span></TooltipHint>
        </div>
      ))}
    </div>
  );
}

export function FittingReadouts({ groups, ductsHref, waiting }: { groups: readonly FittingGroup[]; ductsHref: string; waiting: string | null }) {
  return (
    <section aria-label="Fittings" data-ledger-fittings="" className="flex flex-col gap-1 t-small">
      <h3 className="t-head">Fittings</h3>
      {groups.length ? groups.map((g) => <Group key={g.key} group={g} ductsHref={ductsHref} />)
        : <p className="text-ink-2">{waiting ?? "No fittings on this fan's walk"}</p>}
    </section>
  );
}
