import { useEffect, useState } from "react";
import { actionReceiptSchema, type ActionReceipt } from "@pe/agent-contracts";
import { peReadings, dirty, useHostCall, useAction, type Readings } from "#/readings";
import { actionControls, type ActionListFilter, type ActionControlKey } from "@pe/agent-contracts";
import {
  controlAction,
  readScopedActionStatuses,
  readLegacyActionJournal,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { ActionButton } from "#/components/lang/action-button";

/**
 * A receipt reads its original ID, independent of the current pane or thread Scope. `base` and
 * `resources` are the owner it reads through: a summary and its detail must address the same
 * owner, so a caller that can run under a scoped demo passes that scope's base and client.
 */
export function ActionReceiptView({
  id,
  watch = false,
  base = "",
  resources = peReadings,
}: {
  id: string;
  watch?: boolean;
  base?: string;
  resources?: Readings;
}) {
  // The receipt reads its own id through the owner it was given: one call, no cache, no poll.
  const receipt = useHostCall(
    () => controlAction("action.read", { id }, base) as Promise<ActionReceipt>,
    ["actions", base, id],
  );
  const control = useAction(
    (key: ActionControlKey) => controlAction(key, { id }, base, "human"),
    // A control changes the receipt, so the receipt is reacquired rather than patched in place.
    () => {
      receipt.refresh();
      dirty({ kind: "receipts", id });
    },
  );
  // `watch` puts this receipt on the one stream; without it nothing is opened for it.
  const [watched, setWatched] = useState<ActionReceipt | undefined>(undefined);
  useEffect(() => {
    if (!watch) return;
    return resources.subscribe({ kind: "receipts", id }, (update) => {
      if (update.kind !== "snapshot") return;
      const rows = actionReceiptSchema.array().safeParse(update.value);
      if (rows.success) setWatched(rows.data.find((row) => row.id === id));
    });
  }, [id, watch, resources]);
  const row = watched ?? receipt.data;
  return (
    <div className="space-y-1 p-2">
      <div>
        Action {id} /{" "}
        {row?.kind === "operation" && row.state === "succeeded"
          ? "reply received"
          : (row?.state ?? (receipt.error ? "receipt read failed" : "reading receipt"))}
      </div>
      {row && (
        <>
          <div>
            {row.key} / {row.startedAt} /{" "}
            {row.destination.kind === "document"
              ? `${row.destination.ref.session} / ${row.destination.ref.openId}`
              : row.destination.kind}
          </div>
          {row.steps.map((step) => (
            <div key={step.id}>
              {step.kind} / {step.key} /{" "}
              {row.kind === "operation" && step.state === "succeeded"
                ? "reply received"
                : step.state}
              {"error" in step ? ` / ${step.error}` : ""} <code>{step.id}</code>
            </div>
          ))}
          <div>
            {row.kind === "operation" ? "Operation reply" : "Work publication"} /{" "}
            {row.kind === "operation" ? row.state : row.publication.state}
            {row.publication.state === "recorded"
              ? ` / ${JSON.stringify(row.publication.result)}`
              : ""}
          </div>
          {"error" in row && <div role="status">{row.error}</div>}
          {row.kind === "operation" && "result" in row && (
            <pre aria-label="Returned operation payload">{JSON.stringify(row.result, null, 2)}</pre>
          )}
        </>
      )}
      {(receipt.error || control.error) && (
        <div role="alert">{String(receipt.error ?? control.error)}</div>
      )}
      <div className="flex gap-2">
        {(Object.keys(actionControls) as ActionControlKey[]).map((key) => (
          <ActionButton
            key={key}
            label={
              key === "action.resume"
                ? "resume original action"
                : key === "action.recover"
                  ? "recover native receipt"
                  : "read status"
            }
            reason={actionControls[key].description}
            disabled={
              control.isPending ||
              (key !== "action.read" &&
                row?.state !== "unknown" &&
                !(key === "action.resume" && row?.state === "incomplete"))
            }
            onClick={() => control.mutate(key)}
          />
        ))}
      </div>
    </div>
  );
}

/** The host list is authoritative; mount never resumes or recovers an action. */
export function ActionReceipts({
  scope,
  lastId,
}: {
  scope: ActionListFilter | null;
  lastId?: string | null;
}) {
  const query = useHostCall(
    (signal) => readScopedActionStatuses(scope!, "", signal, lastId ?? undefined),
    ["actions", "subject", scope, lastId],
    scope !== null,
  );
  const legacy = useHostCall(
    (signal) => readLegacyActionJournal("", signal),
    ["actions", "legacy", scope, lastId],
    scope !== null,
  );
  // A state change in the list is the subject changing, so each receipt reacquires its own.
  useEffect(() => {
    for (const status of query.data ?? []) dirty({ kind: "receipts", id: status.id });
  }, [query.data]);
  if (!scope) return null;
  const ids = (query.data ?? []).map((row) => row.id);
  return (
    <section aria-label="Actions for this selection">
      {legacy.error ? (
        <div role="alert">Earlier action status unavailable: {String(legacy.error)}</div>
      ) : legacy.data?.unresolved.length ? (
        <details>
          <summary role="alert">
            {legacy.data.unresolved.length} earlier operations block new actions
          </summary>
          <p>The host cannot confirm their outcomes. This block applies across selections.</p>
          {legacy.data.unresolved.map((row) => (
            <details key={row.archiveRef}>
              <summary>
                {row.key.includes("route-workspace:settings")
                  ? "Settings operation"
                  : row.key.includes("families:")
                    ? "Families operation"
                    : "Earlier operation"}{" "}
                ? outcome unknown
              </summary>
              <div className="break-all">{row.archiveRef}</div>
              <div className="break-all">Source: {row.source}</div>
              <pre className="whitespace-pre-wrap break-all">{row.value}</pre>
            </details>
          ))}
        </details>
      ) : null}
      {scope.kind === "family-file" && (
        <div>Saved file actions; each receipt names its original document lifetime</div>
      )}
      {query.isPending ? (
        <div role="status">Reading actions for this selection</div>
      ) : query.error ? (
        <div role="alert">Action list unavailable: {String(query.error)}</div>
      ) : ids.length === 0 ? (
        <div>
          {legacy.data?.unresolved.length
            ? "No actions recorded for this selection; earlier operations still block it"
            : "No unresolved actions for this selection"}
        </div>
      ) : null}
      {ids.map((id) => (
        <ActionReceiptView key={id} id={id} />
      ))}
    </section>
  );
}
