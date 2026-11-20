import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "@pe/kit/lang/popover";
import { routeAddress, type RoomsPartitionProgress } from "@pe/agent-contracts";
import type { TimelineOwner } from "./situation-band";
import { activityTime, timelineRowKey } from "./timeline";

const phaseLabel: Record<RoomsPartitionProgress["phase"], string> = {
  Prepare: "Reading model geometry",
  Capture: "Finding walls and openings",
  Designation: "Identifying zones",
  Solve: "Finding rooms",
  Materialization: "Drawing room outlines",
  Commit: "Applying changes",
};

/** Draw host order directly, including the findings Work. No browser reconstruction. */
export function GraphHistory({ owner }: { owner: TimelineOwner }) {
  useSyncExternalStore(owner.subscribe, owner.revision, owner.revision);
  const timeline = owner.timeline();
  const active = timeline?.rows.findLast(
    (row) => row.kind === "receipt" && ["queued", "running", "stopping"].includes(row.state),
  );
  const activeKey = active ? timelineRowKey(active) : null;
  const revealed = useRef<string | null>(null);
  const rows = [
    ...owner.pendingEdits().map((intent) => ({
      key: `intent:${intent.id}`,
      label: intent.label,
      sub: intent.reason ?? "Awaiting acknowledgement",
      persistentActions: false,
      actions: (
        <>
          <Popover>
            <PopoverTrigger aria-label={`Inspect ${intent.label}`}>Inspect</PopoverTrigger>
            <SubjectPopoverContent aria-label={`Original input: ${intent.label}`}>
              <pre>{JSON.stringify(intent.input, null, 2)}</pre>
            </SubjectPopoverContent>
          </Popover>
          <Button
            label={`Discard ${intent.label}`}
            refusal={intent.status === "pending" ? "Awaiting acknowledgement" : null}
            onClick={() => owner.discardIntent(intent.id)}
          >
            Discard
          </Button>
        </>
      ),
    })),
    ...(timeline?.rows ?? []).map((row) => ({
      key: timelineRowKey(row),
      persistentActions: row.kind === "receipt" && ["queued", "running"].includes(row.state),
      label: row.kind === "home-write" ? row.place : row.kind === "point" ? row.reason : row.label,
      sub: [
        row.kind === "edit" || row.kind === "restore"
          ? `${row.work.route} / ${row.by === "pea" ? "Pea" : "you"} / ${row.state}${row.notWritten ? ` / not written${row.notWritten.rejected ? " / rejected" : ""}` : ""} / r${row.revision}`
          : row.kind === "receipt"
            ? `${row.by === "pea" ? "Pea" : "you"} / ${row.state === "stopping" ? "Stopping…" : row.state}`
            : row.kind,
        activityTime(row.at),
        row.kind === "receipt" &&
        (row.state === "running" || row.state === "stopping") &&
        row.progress
          ? row.progress.zonesTotal === null
            ? phaseLabel[row.progress.phase]
            : `${phaseLabel[row.progress.phase]} · ${row.progress.zonesDone}/${row.progress.zonesTotal} zones done`
          : null,
        "blockedBy" in row
          ? row.blockedBy && "receipt" in row.blockedBy
            ? row.blockedBy.label
            : row.blockedBy?.reason
          : null,
      ]
        .filter(Boolean)
        .join(" / "),
      actions:
        row.kind === "receipt" ? (
          <>
            <a data-priority="2" href={routeAddress("ops").link({ actionId: row.id })}>
              Inspect
            </a>
            {["queued", "running", "outcome-unknown"].includes(row.state) && (
              <Button label="Stop command" onClick={() => void owner.stopCommand(row.id)}>
                Stop
              </Button>
            )}
          </>
        ) : null,
    })),
  ];
  const list = useList({
    items: rows,
    keyOf: (row) => row.key,
    search: (row) => ({ text: [row.label, row.sub] }),
    select: "none",
  });
  const { reveal } = list;
  useLayoutEffect(() => {
    if (!activeKey || activeKey === revealed.current) return;
    revealed.current = activeKey;
    reveal(activeKey);
  }, [activeKey, reveal]);
  return (
    <section aria-label="Timeline activity">
      {owner.timelineRefusal() && <div role="status">{owner.timelineRefusal()}</div>}
      {[
        ...new Set(
          Object.values(timeline?.refusal ?? {}).filter((reason): reason is string => !!reason),
        ),
      ].map((reason) => (
        <OutcomeLine key={reason} kind="refused" label={reason} />
      ))}
      {(timeline || rows.length > 0) && (
        <ListView
          list={list}
          aria-label="Timeline activity"
          maxHeight="min(24rem, 60vh)"
          row={(row) => ({
            label: row.label,
            sub: row.sub,
            actions: row.actions,
            persistentActions: row.persistentActions,
            lines: 3,
          })}
          empty={{ message: "No activity yet", exit: "Run a command or edit Work" }}
        />
      )}
    </section>
  );
}
