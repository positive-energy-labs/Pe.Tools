/**
 * The transcript's record lines for Pea's route work. No verbs: `open ›` hosts the owning route
 * beside the thread, where the Work's cells and a receipt's recover/resume/stop verbs live.
 */
import { Link } from "@tanstack/react-router";
import type { ActionReceipt } from "@pe/agent-contracts";

import { Press } from "#/components/lang/press";
import { previousOf, useReading } from "#/readings";
import {
  actionRoute,
  actionWord,
  chatPluginTitle,
  type ActionCall,
  type ProposedRecord,
} from "./chat-plugins";
import { useWorkbench } from "./provider";

const line = "flex min-w-0 items-baseline gap-2 t-small text-ink-2";

/** `Pea proposed {n} changes in {Route} · {Subject}`: counts are the call's own, never live Work. */
export function ProposedLine({ record }: { record: ProposedRecord }) {
  const { store } = useWorkbench();
  return (
    <div className={line} data-proposed={record.route}>
      <span className="truncate">
        Pea proposed {record.changes} change{record.changes === 1 ? "" : "s"} in{" "}
        {chatPluginTitle(record.route)}
        {record.subject ? ` · ${record.subject}` : ""}
      </span>
      <Press tone="quiet" size="caption" onClick={() => store.actions.setPlugin(record.route)}>
        open ›
      </Press>
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
  const state = row?.state ?? (reading.state === "failed" ? "receipt unread" : "reading");
  return (
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
      {route ? (
        <Press tone="quiet" size="caption" onClick={() => store.actions.setPlugin(route)}>
          open ›
        </Press>
      ) : (
        <Link to="/ops" search={{ actionId: call.id }}>
          receipt ›
        </Link>
      )}
    </div>
  );
}
