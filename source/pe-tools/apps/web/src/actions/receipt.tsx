import { actionReceiptSchema, type ActionReceipt } from "@pe/agent-contracts";
import {
  peReadings,
  dirty,
  previousOf,
  useHostCall,
  useAction,
  useReading,
  type Readings,
} from "#/readings";
import { actionControls, type ActionListFilter, type ActionControlKey } from "@pe/agent-contracts";
import {
  controlAction,
  readScopedActionStatuses,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { ActionButton } from "#/components/lang/action-button";
import { Code, stringify } from "#/components/lang/code";

/**
 * A receipt reads its original ID, independent of the current pane or thread Scope. `base` and
 * `resources` are the owner it reads through: a summary and its detail must address the same
 * owner, so a caller that can run under a scoped demo passes that scope's base and client.
 */
export function ActionReceiptView({
  id,
  base = "",
  resources = peReadings,
}: {
  id: string;
  base?: string;
  resources?: Readings;
}) {
  const receipt = useReading<ActionReceipt[]>({ kind: "receipts", id }, resources);
  const control = useAction(
    (key: ActionControlKey) => controlAction(key, { id }, base, "human"),
    () => dirty({ kind: "receipts", id }, resources),
  );
  const observed = previousOf(receipt);
  const rows = actionReceiptSchema.array().safeParse(observed);
  const row = rows.success ? rows.data.find((candidate) => candidate.id === id) : undefined;
  const receiptError =
    receipt.state === "failed"
      ? Error(receipt.message)
      : observed !== undefined && !rows.success
        ? Error(rows.error.message)
        : undefined;
  return (
    <div className="space-y-1 p-2">
      <div>
        Action {id} /{" "}
        {row?.kind === "operation" && row.state === "succeeded"
          ? "reply received"
          : (row?.state ?? (receiptError ? "receipt read failed" : "reading receipt"))}
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
              <code>{step.id}</code>
              {"error" in step && (
                <details>
                  <summary>Step error</summary>
                  <Code code={step.error} lang="plaintext" tone="error" />
                </details>
              )}
            </div>
          ))}
          <div>
            {row.kind === "operation" ? "Operation reply" : "Work publication"} /{" "}
            {row.kind === "operation" ? row.state : row.publication.state}
            {row.publication.state === "recorded"
              ? ` / ${JSON.stringify(row.publication.result)}`
              : ""}
          </div>
          {"error" in row && (
            <details>
              <summary>{row.error.split("\n")[0]}</summary>
              <Code code={row.error} lang="plaintext" tone="error" />
            </details>
          )}
          {row.kind === "operation" && "result" in row && (
            <Code code={stringify(row.result)} lang="json" title="Returned operation payload" />
          )}
        </>
      )}
      {(receiptError || control.error) && (
        <div role="alert">{String(receiptError ?? control.error)}</div>
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

/** The one-shot list preserves `lastId`, which the shared Reading request cannot express. */
export function ActionReceipts({
  scope,
  lastId,
}: {
  scope: ActionListFilter | null;
  lastId?: string | null;
}) {
  const scopeDeps = [
    scope?.kind,
    scope?.workspaceId,
    scope?.kind === "family" ? scope.target.session : null,
    scope?.kind === "family" ? scope.target.openId : null,
  ] as const;
  const query = useHostCall(
    (signal) => readScopedActionStatuses(scope!, "", signal, lastId ?? undefined),
    ["actions", "subject", ...scopeDeps, lastId],
    scope !== null,
  );
  if (!scope) return null;
  const ids = (query.data ?? []).map((row) => row.id);
  return (
    <section aria-label="Actions for this selection">
      {scope.kind === "family-file" && (
        <div>Saved file actions; each receipt names its original document lifetime</div>
      )}
      {query.isPending ? (
        <div role="status">Reading actions for this selection</div>
      ) : query.error ? (
        <div role="alert">Action list unavailable: {String(query.error)}</div>
      ) : ids.length === 0 ? (
        <div>No unresolved actions for this selection</div>
      ) : null}
      {(query.data ?? []).map((row) => (
        <ActionReceiptView key={row.id} id={row.id} />
      ))}
    </section>
  );
}
