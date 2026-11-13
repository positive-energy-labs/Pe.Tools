import { useSyncExternalStore } from "react";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "@pe/kit/lang/popover";
import { routeAddress } from "@pe/agent-contracts";
import type { TimelineOwner } from "./situation-band";
import { activityTime, timelineRowKey } from "./timeline";

/** Draw host order directly, including the findings Work. No browser reconstruction. */
export function GraphHistory({ owner }: { owner: TimelineOwner }) {
  useSyncExternalStore(owner.subscribe, owner.revision, owner.revision);
  const rows = [
    ...owner.pendingEdits().map(intent => ({ key: `intent:${intent.id}`, label: intent.label,
      sub: intent.reason ?? "Awaiting acknowledgement", actions: <>
        <Popover><PopoverTrigger aria-label={`Inspect ${intent.label}`}>Inspect</PopoverTrigger>
          <SubjectPopoverContent aria-label={`Original input: ${intent.label}`}><pre>{JSON.stringify(intent.input, null, 2)}</pre></SubjectPopoverContent>
        </Popover>
        <Button label={`Discard ${intent.label}`} refusal={intent.status === "pending" ? "Awaiting acknowledgement" : null}
          onClick={() => owner.discardIntent(intent.id)}>Discard</Button>
      </> })),
    ...(owner.timeline()?.rows ?? []).map(row => ({ key: timelineRowKey(row),
      label: row.kind === "home-write" ? row.place : row.kind === "point" ? row.reason : row.label,
      sub: [row.kind === "edit" || row.kind === "restore" ? `${row.work.route} / ${row.by === "pea" ? "Pea" : "you"} / ${row.state} / r${row.revision}` : row.kind === "receipt" ? `${row.by === "pea" ? "Pea" : "you"} / ${row.state}` : row.kind,
        activityTime(row.at), "blockedBy" in row ? row.blockedBy && "receipt" in row.blockedBy ? row.blockedBy.label : row.blockedBy?.reason : null].filter(Boolean).join(" / "),
      actions: row.kind === "receipt" ? <><a href={routeAddress("ops").link({ actionId: row.id })}>Inspect</a>
        {["queued", "running", "outcome-unknown"].includes(row.state) && <Button label="Stop command" onClick={() => void owner.stopCommand(row.id)}>Stop</Button>}</> : null,
    })),
  ];
  const list = useList({ items: rows, keyOf: row => row.key, search: row => ({ text: [row.label, row.sub] }), select: "none" });
  return <section aria-label="Timeline activity">
    {owner.timelineRefusal() && <div role="status">{owner.timelineRefusal()}</div>}
    {[...new Set(Object.values(owner.timeline()?.refusal ?? {}).filter((reason): reason is string => !!reason))]
      .map(reason => <OutcomeLine key={reason} kind="refused" label={reason} />)}
    {(owner.timeline() || rows.length > 0) && <ListView list={list} aria-label="Timeline activity" row={row => ({ label: row.label, sub: row.sub, actions: row.actions, lines: 3 })}
      empty={{ message: "No activity yet", exit: "Run a command or edit Work" }} />}
  </section>;
}
