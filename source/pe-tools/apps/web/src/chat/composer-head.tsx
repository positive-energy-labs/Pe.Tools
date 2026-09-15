/**
 * THE COMPOSER HEAD — Chat's whole Situation (design-system ledger, 2026-09-13). Chat has no
 * route head: "Pea on project-a" with the document's health, a document-only target bound through
 * the thread head (`PUT /scope/:thread`, not `?target`), Send as the one verb with the
 * Situation's flag, and Pea's proposals as the Work band under the verb row, so approve and
 * reject have one location and the stream stays a record.
 */
import { useAtomValue } from "@effect/atom-react";
import { resolveCallTarget, toolTitle, type TargetResolution } from "@pe/agent-contracts";
import { Check, X } from "lucide-react";

import { ActionButton } from "#/components/lang/action-button";
import { targetInventory } from "#/readings";
import { Picker } from "#/route/picker";
import { ChainLamp, Cluster, Ledger, PageLog, useDocumentLadder } from "#/route/situation";
import type { ActionHandle, RouteHandle } from "#/route/use-route";
import type { ChatReading } from "#/chat/manifest";
import { useThreadScope } from "#/chat/scope";
import type { ChatPage } from "#/chat/seeds";
import {
  APPROVAL_OPTIONS,
  selectApprovals,
  selectRunStatus,
  type ChatState,
} from "#/workbench/chat-state";
import { useWorkbench, type WorkbenchAttachment } from "#/workbench/provider";

export type ChatHandle = RouteHandle<ChatState, ChatReading, ChatPage, "send" | "cancel">;

/**
 * Send, scoped to the composer draft: the one verb, whether pressed in the head or entered in the
 * textarea. The route declares it once (`chat/manifest.ts`); this only names its input.
 */
export function useSend(
  handle: ChatHandle,
  draftOverride?: { text: string; attachments: WorkbenchAttachment[] },
): ActionHandle {
  const { store } = useWorkbench();
  const liveDraft = useAtomValue(store.atoms.draft);
  const draft = draftOverride ?? liveDraft;
  const send = handle.actions.send;
  const empty = !draft.text.trim() && draft.attachments.length === 0;
  return {
    ...send,
    refusal: send.refusal ?? (empty ? "Enter a prompt or attachment" : null),
    run: async () => {
      return send.run({
        text: draft.text.trim(),
        attachments: draft.attachments.length ? draft.attachments : undefined,
      });
    },
  };
}

/** Why the thread's chosen document does not resolve right now. */
const complaint = (resolution: TargetResolution): string | null =>
  resolution.kind === "resolved"
    ? null
    : resolution.kind === "checking"
      ? "checking the inventory"
      : resolution.kind === "failed"
        ? resolution.message
        : {
            missing: "no document chosen",
            "session-gone": "the Revit holding it ended — choose again",
            "document-closed": "it is no longer open — choose again",
            "wrong-document-kind": "that document is the wrong kind for this call",
            ambiguous: "two Revits hold it — choose the document again",
          }[resolution.reason];

export function ComposerHead({ handle }: { handle: ChatHandle }) {
  const { currentThreadId, threads, chat, resolveApproval } = useWorkbench();
  const isRunning = selectRunStatus(chat) !== "idle";
  const head = useThreadScope(currentThreadId, !handle.demo, handle.readings.head);
  const inventory = targetInventory(
    handle.readings.inventory as Parameters<typeof targetInventory>[0],
  );
  const resolution = resolveCallTarget({ needs: "document" }, head.defaultTarget, inventory);
  const bound =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : null;
  const ladder = useDocumentLadder(handle, undefined, {
    bound,
    bind: (ref) => {
      void head.set({ kind: "open", ref });
    },
  });
  const targetDisabled = isRunning || head.stale;
  const levels = ladder.levels.map((level, index) =>
    index === 0
      ? {
          ...level,
          placeholder: head.defaultTarget ? level.placeholder : "optional Revit target",
          extra: head.defaultTarget ? (
            <div className="hairline-t mt-1 px-2 pt-1">
              <ActionButton
                tone="act"
                icon={X}
                label="Clear target"
                reason="Run this chat without a Revit target"
                disabled={targetDisabled}
                onClick={() => {
                  void head.set(null);
                }}
              />
            </div>
          ) : undefined,
        }
      : level,
  );
  const health = head.defaultTarget ? complaint(resolution) : null;
  const approvals = selectApprovals(chat.display);
  const threadLabel = threads.find((item) => item.id === currentThreadId)?.title ?? currentThreadId;
  return (
    <section
      aria-label="Situation"
      className="hairline-b flex min-w-0 flex-col gap-1 px-3 pt-2 pb-1"
      data-testid="composer-head"
    >
      <div className="flex min-w-0 items-center justify-between gap-4">
        <p className="t-prose text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
          <b>Pea</b> on{" "}
          <Picker
            levels={levels}
            caution={Boolean(health)}
            disabled={targetDisabled}
            title={
              ladder.sessionWord
                ? `${ladder.sessionWord} › ${ladder.docWord ?? "no document"}; pick to change`
                : "choose a session and a document; Chat runs without one, Revit operations do not"
            }
          />
          {head.refusal ? (
            <span className="ml-3 t-small" data-tone="caution">
              {head.refusal}
            </span>
          ) : null}
        </p>
        <Cluster
          handle={handle}
          lamp={
            <ChainLamp
              handle={handle}
              health={health}
              session={ladder.sessionWord}
              document={ladder.docWord}
            />
          }
          state={
            <>
              <Ledger
                rows={[
                  ["thread", threadLabel],
                  [
                    "target",
                    head.defaultTarget
                      ? `r${head.revision}${head.stale ? " · stale" : ""}`
                      : "none · Chat runs; Revit operations need a document",
                  ],
                ]}
              />
              <PageLog entries={handle.log} />
            </>
          }
        />
      </div>
      {approvals.length ? (
        <div
          aria-label="Pea proposals"
          className="hairline-t hairline-b flex flex-col gap-1 py-2 t-prose"
        >
          <span>
            <b>
              {approvals.length} proposal{approvals.length === 1 ? "" : "s"}
            </b>{" "}
            waiting on you
          </span>
          {approvals.map((approval) => (
            <div
              key={approval.toolCallId}
              className="flex flex-wrap items-baseline gap-3"
              data-tool-id={approval.toolCallId}
            >
              <span className="face-mono text-ink">⌗ {toolTitle(approval.toolName)}</span>
              <span className="t-small text-ink-2">{approval.kind}</span>
              {approval.kind === "suspension" && approval.toolName === "ask_user" ? (
                <span className="text-ink-2">answer it in the stream</span>
              ) : (
                APPROVAL_OPTIONS.map((option) => {
                  const allow = option.kind.startsWith("allow");
                  return (
                    <ActionButton
                      key={option.id}
                      tone={allow ? "commit" : "act"}
                      icon={allow ? Check : X}
                      label={option.label}
                      reason={
                        allow
                          ? `Let pea run ${toolTitle(approval.toolName)} — the call executes against the live target`
                          : `Refuse this ${toolTitle(approval.toolName)} call — pea continues without it`
                      }
                      onClick={() => {
                        void resolveApproval(approval.toolCallId, option.id);
                      }}
                    />
                  );
                })
              )}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
