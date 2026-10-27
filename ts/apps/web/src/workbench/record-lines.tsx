/**
 * The transcript's record lines for Pea's route work. No verbs: `open ›` hosts the owning route
 * beside the thread, where the Work's cells and a receipt's recover/resume/stop verbs live.
 */
import { Link } from "@tanstack/react-router";
import type { ActionReceipt } from "@pe/agent-contracts";

import { Button } from "@pe/kit/lang/button";
import { previousOf, useReading } from "#/readings";
import {
  actionRoute,
  actionPlace,
  actionWord,
  chatPluginTitle,
  type ActionCall,
  type ProposedRecord,
} from "./chat-plugins";
import { useWorkbench } from "./provider";
import { NativeReadingReferences } from "#/revit/reading-references";

const line = "flex min-w-0 items-baseline gap-2 t-small text-ink-2";

/** `Pea changed {n} cells in {Route} · {Subject}`: counts are the call's own, never live Work. */
export function ProposedLine({ record }: { record: ProposedRecord }) {
  const { store } = useWorkbench();
  const place = record.place;
  return (
    <div className={line} data-proposed={record.route}>
      <span className="truncate">
        Pea changed {record.changes} cell{record.changes === 1 ? "" : "s"} in{" "}
        {chatPluginTitle(record.route)}
        {record.subject ? ` · ${record.subject}` : ""}
      </span>
      <Button
        label="open ›"
        refusal={place.ok ? null : place.refusal}
        onClick={() => place.ok && void store.actions.openTab(place.route, place.page, place.carry)}
      >
        open ›
      </Button>
      {!place.ok ? <span data-tone="caution">{place.refusal}</span> : null}
    </div>
  );
}

/**
 * `Pea ran {action} in {Route} · {state}`: the state is the receipt's CURRENT one, read live, and
 * only `succeeded` reads as done. An action no plugin route owns keeps its receipt link.
 */
export function ActionLine({ call }: { call: ActionCall }) {
  const { store } = useWorkbench();
  const reading = useReading<ActionReceipt[]>({ kind: "receipts", id: call.id });
  const row = previousOf(reading)?.find((candidate) => candidate.id === call.id);
  // A control (`action.resume`) names the original receipt; its key is the action's own.
  const key = row?.key ?? call.key;
  const route = actionRoute(key);
  const place = route ? actionPlace(route, row) : null;
  const state = row?.state ?? (reading.state === "failed" ? "receipt unread" : "reading");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className={line} data-action={call.id}>
        <span className="truncate">
          Pea ran {actionWord(key)}
          {route ? ` in ${chatPluginTitle(route)}` : ""} ·{" "}
          <span
            className="face-mono"
            data-tone={
              state === "succeeded"
                ? "done"
                : state === "running" || state === "reading"
                  ? undefined
                  : "caution"
            }
          >
            {state}
          </span>
        </span>
        {place?.ok ? (
          <Button
            label="open ›"
            onClick={() => void store.actions.openTab(place.route, place.page, place.carry)}
          >
            open ›
          </Button>
        ) : (
          <Link to="/ops" search={{ actionId: call.id }}>
            receipt ›
          </Link>
        )}
      </div>
      {place && !place.ok ? <span data-tone="caution">{place.refusal}</span> : null}
      {row?.state === "succeeded" ? <NativeReadingReferences receipt={row} /> : null}
    </div>
  );
}
