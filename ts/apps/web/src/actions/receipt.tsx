import { actionReceiptSchema, type ActionReceipt } from "@pe/agent-contracts";
import { peReadings, dirty, previousOf, useAction, useReading, type Readings } from "#/readings";
import { actionControls, type ActionControlKey } from "@pe/agent-contracts";
import { controlAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { Button } from "@pe/kit/lang/button";
import { ArtifactFrame } from "@pe/kit/lang/artifact-frame";
import { Code, stringify } from "@pe/kit/lang/code";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { outputRenderers } from "#/ops/renderers";

/**
 * The one word for an action's state. An operation's success is a reply received, never a
 * certified mutation; every surface that names an action's state reads it from here.
 */
export const stateWord = (row: Pick<ActionReceipt, "kind" | "state">): string =>
  row.kind === "operation" && row.state === "succeeded" ? "reply received" : row.state;

const OUTCOME_OF: Record<ActionReceipt["state"], OutcomeKind> = {
  running: "busy",
  succeeded: "receipt",
  failed: "error",
  cancelled: "advisory",
  unknown: "advisory",
  incomplete: "advisory",
};

/** The one projection from a receipt row to the line a surface draws after a verb. */
export const actionOutcome = (row: ActionReceipt): { kind: OutcomeKind; label: string } => ({
  kind: OUTCOME_OF[row.state],
  label: `${row.key} ${stateWord(row)} · action ${row.id}`,
});

/** Reads one action's receipt and draws its line; it follows the receipt, not the reply. */
export function ActionOutcome({
  id,
  resources = peReadings,
}: {
  id: string;
  resources?: Readings;
}) {
  const receipt = useReading<ActionReceipt[]>({ kind: "receipts", id }, resources);
  const rows = actionReceiptSchema.array().safeParse(previousOf(receipt));
  const row = rows.success ? rows.data.find((candidate) => candidate.id === id) : undefined;
  if (row) return <OutcomeLine {...actionOutcome(row)} />;
  if (receipt.state === "failed")
    return (
      <OutcomeLine kind="error" label={`action ${id} receipt read failed: ${receipt.message}`} />
    );
  return <OutcomeLine kind="busy" label={`action ${id} · reading receipt`} />;
}

/**
 * A receipt reads its original ID, independent of the current pane or thread Scope. `base` and
 * `resources` are the owner it reads through: a summary and its detail must address the same
 * owner, so a caller that can run under a scoped demo passes that scope's base and client.
 */
/** Each control's word, and the states it can actually reach. `read` reaches every state. */
const CONTROL_LABEL: Record<ActionControlKey, string> = {
  "action.read": "read status",
  "action.recover": "recover native receipt",
  "action.resume": "resume original action",
  "action.cancel": "stop this action",
};
const CONTROL_REACHES: Record<ActionControlKey, (state: string | undefined) => boolean> = {
  "action.read": () => true,
  "action.recover": (state) => state === "unknown",
  "action.resume": (state) => state === "unknown" || state === "incomplete",
  // Only a running action has an in-flight request to signal.
  "action.cancel": (state) => state === "running",
};

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
    (key: ActionControlKey) => controlAction(key, { id }, base),
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
    <ArtifactFrame
      head={
        <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
          <span className="truncate t-small face-mono text-ink">
            Action {id} /{" "}
            {row ? stateWord(row) : receiptError ? "receipt read failed" : "reading receipt"}
          </span>
          {row ? (
            <span
              className="t-small face-mono"
              data-tone={
                row.state === "succeeded" ? "done" : row.state === "unknown" ? "caution" : undefined
              }
            >
              {row.state}
            </span>
          ) : null}
        </div>
      }
      foot={
        <div className="flex flex-wrap gap-2">
          {(Object.keys(actionControls) as ActionControlKey[]).map((key) => (
            <Button
              key={key}
              kind="framed"
              label={CONTROL_LABEL[key]}
              reason={actionControls[key].says}
              refusal={
                control.isPending || !CONTROL_REACHES[key](row?.state)
                  ? actionControls[key].says
                  : null
              }
              onClick={() => control.mutate(key)}
            >
              {CONTROL_LABEL[key]}
            </Button>
          ))}
        </div>
      }
    >
      <div className="grid min-w-0 gap-1 px-2.5 py-2 t-small">
        {row && (
          <>
            <div className="truncate face-mono text-ink-2">
              {row.key} / {row.startedAt} /{" "}
              {row.destination.kind === "document"
                ? `${row.destination.ref.session} / ${row.destination.ref.openId}`
                : row.destination.kind}
            </div>
            {row.steps.map((step) => (
              <div key={step.id} className="min-w-0 face-mono text-ink-2">
                <span className="truncate">
                  {step.kind} / {step.key} / {stateWord({ kind: row.kind, state: step.state })}
                </span>{" "}
                <code>{step.id}</code>
                {"error" in step && (
                  <details>
                    <summary>Step error</summary>
                    <Code code={step.error} lang="plaintext" tone="error" wrap />
                  </details>
                )}
              </div>
            ))}
            <div className="truncate text-ink">
              {row.kind === "operation" ? "Operation reply" : "Work publication"} /{" "}
              {row.kind === "operation" ? row.state : row.publication.state}
              {row.publication.state === "recorded"
                ? ` / ${JSON.stringify(row.publication.result)}`
                : ""}
            </div>
            {"error" in row && (
              <details>
                <summary data-tone="caution">{row.error.split("\n")[0]}</summary>
                <Code code={row.error} lang="plaintext" tone="error" wrap />
              </details>
            )}
            {row.kind === "operation" && "result" in row && outputRenderers[row.key]
              ? (() => {
                  const Output = outputRenderers[row.key]!;
                  return <Output data={row.result} opKey={row.key} request={row.request} />;
                })()
              : null}
            {row.kind === "operation" &&
              "result" in row && (
                // The payload is the biggest thing a receipt holds and the least often wanted:
                // folded by default; `Code` clamps it, so it scrolls inside its own frame.
                <details>
                  <summary className="cursor-pointer text-ink-2">Returned payload</summary>
                  <Code
                    code={stringify(row.result)}
                    lang="json"
                    title="Returned operation payload"
                  />
                </details>
              )}
          </>
        )}
        {(receiptError || control.error) && (
          <div role="alert" data-tone="caution">
            {String(receiptError ?? control.error)}
          </div>
        )}
      </div>
    </ArtifactFrame>
  );
}
