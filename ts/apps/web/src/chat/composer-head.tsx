/**
 * THE COMPOSER HEAD — Chat's whole Situation (design-system ledger, 2026-09-13). Chat has no
 * route head: "Pea on project-a" with the document's health, a document-only target bound through
 * the thread head (`PUT /scope/:thread`; a `?target` pin seeds a document-less thread once), Send as the one verb with the
 * Situation's flag, and Pea's proposals as the Work band under the verb row, so approve and
 * reject have one location and the stream stays a record.
 */
import { useEffect, useRef } from "react";
import { AskUserPrompt, readQuestion } from "#/chat/ask-prompt";
import { resolveCallTarget, toolTitle, type TargetResolution } from "@pe/agent-contracts";
import { Check, X } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";

import { ActionButton } from "#/components/lang/action-button";
import { Rail } from "#/components/lang/rail";
import { targetInventory } from "#/readings";
import { Ladder } from "#/route/ladder";
import { Ledger, PageLog } from "#/route/situation-grids";
import { useDocumentLadder } from "#/route/situation-ladder";
import { ChainLamp, Cluster } from "#/route/situation-lamp";
import { SituationCell } from "#/route/situation-marks";
import { parseTarget } from "#/route/route-target";
import type { ActionHandle, RouteHandle } from "#/route/use-route";
import type { ChatReading, ChatActionKey } from "#/chat/manifest";
import { useThreadScope } from "#/chat/scope";
import type { ChatPage } from "#/chat/seeds";
import {
  APPROVAL_OPTIONS,
  isParkedAsk,
  selectApprovals,
  selectRunStatus,
  selectToolCalls,
  toolTarget,
  type ChatState,
} from "#/workbench/chat-state";
import { useWorkbench } from "#/workbench/provider";

import { useHeadWorks } from "./head-works";
import { ProposalHead } from "./proposal-head";
import type { ChatDraft } from "#/workbench/prompt";

export type ChatHandle = RouteHandle<ChatState, ChatReading, ChatPage, ChatActionKey>;

/**
 * Send, scoped to the composer draft: the one verb, whether pressed in the head or entered in the
 * textarea. The route declares it once (`chat/manifest.ts`); this only names its input.
 */
export function useSend(
  handle: ChatHandle,
  draft: ChatDraft,
  onSent?: (sent: ChatDraft) => void,
): ActionHandle {
  const send = handle.actions.send;
  const empty = !draft.text.trim() && draft.attachments.length === 0;
  return {
    ...send,
    refusal: send.refusal ?? (empty ? "Enter a prompt or attachment" : null),
    run: async () => {
      const result = await send.run({
        text: draft.text.trim(),
        attachments: draft.attachments.length ? draft.attachments : undefined,
      });
      if (!result) onSent?.(draft);
      return result;
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

/** The one open document at a `?target` address pin; none when absent or held twice. */
const pinnedRef = (inventory: ReturnType<typeof targetInventory>, target?: string) => {
  const parsed = parseTarget(target);
  if (parsed?.kind !== "address" || inventory.kind !== "ready") return null;
  const refs = Object.entries(inventory.sessions).flatMap(([session, found]) =>
    found.kind === "ready"
      ? found.values
          .filter((doc) => doc.address === parsed.address)
          .map((doc) => ({ session, openId: doc.openId }))
      : [],
  );
  return refs.length === 1 ? refs[0]! : null;
};

/** The bound document's Address, which keys document-owned Work. */
const documentAddress = (
  inventory: ReturnType<typeof targetInventory>,
  ref: { session: string; openId: string } | null,
) => {
  const found = ref && inventory.kind === "ready" ? inventory.sessions[ref.session] : undefined;
  return found?.kind === "ready"
    ? (found.values.find((doc) => doc.openId === ref!.openId)?.address ?? null)
    : null;
};

export function ComposerHead({
  handle,
  status,
  urlTarget,
}: {
  /** The URL's `?target` pin: a thread with no document takes it once (e2e finding 7). */
  urlTarget?: string;
  handle: ChatHandle;
  /** Thread-level loading/failure. It lives HERE, not in a rail above the transcript: the
   * Situation already answers "what is bound and how is it", and a rail that appears and
   * disappears over the chat shifted the whole lane every time it spoke. */
  status?: { text: string; caution: boolean; detail?: string };
}) {
  const { currentThreadId, threads, chat, openThread, resolveApproval, store } = useWorkbench();
  const isRunning = selectRunStatus(chat) !== "idle";
  const head = useThreadScope(currentThreadId, !handle.demo, handle.readings.head);
  const refusal =
    head.refusal ?? (handle.outcome?.key === "send" ? handle.outcome.refusal?.message : null);
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
  // A new thread under a `?target` address pin binds to the one open document at that address,
  // once per thread: "new" keeps the URL's document. A later clear in the sentence stands.
  const pinned = useRef<string | null>(null);
  const pinRef = pinnedRef(inventory, urlTarget);
  useEffect(() => {
    if (!pinRef || head.stale || !head.hydrated || head.defaultTarget) return;
    if (pinned.current === currentThreadId) return;
    pinned.current = currentThreadId;
    void head.set({ kind: "open", ref: pinRef });
  }, [
    pinRef?.session,
    pinRef?.openId,
    head.stale,
    head.hydrated,
    head.defaultTarget,
    currentThreadId,
  ]);
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
  // Live asks only: an expired ask is a transcript record, never a head row.
  const approvals = selectApprovals(chat.display);
  const works = useHeadWorks(documentAddress(inventory, bound), ladder.docWord ?? "document", {
    open: store.actions.setPlugin,
    planIn: store.actions.planIn,
    planRefusal: useAtomValue(store.atoms.planRefusal),
  });
  // "Do" alone says nothing about what is being asked for. The proposal row names the capability
  // key and the target the call would run against, read off the call itself in the stream.
  const callsById = new Map(selectToolCalls(chat).map((call) => [call.id, call]));
  const selectedThread = threads.find((item) => item.id === currentThreadId);
  const threadOptions = selectedThread
    ? threads
    : [{ id: currentThreadId, title: currentThreadId, updatedAt: "" }, ...threads];
  const threadLabel = selectedThread?.title ?? currentThreadId;
  return (
    <section aria-label="Situation" className="flex min-w-0 flex-col" data-testid="composer-head">
      <Rail
        ground="recess"
        lead={
          <p className="t-prose text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
            <b>Pea</b> in{" "}
            <SituationCell io="rw">
              <Ladder
                levels={[
                  {
                    key: "thread",
                    label: threadLabel,
                    placeholder: "choose a thread",
                    options: threadOptions.map((thread) => ({
                      id: thread.id,
                      label: thread.title,
                      sub: thread.updatedAt || undefined,
                    })),
                    picked: (id) => id === currentThreadId,
                    pick: openThread,
                  },
                ]}
                title="choose the active chat thread"
              />
            </SituationCell>{" "}
            on{" "}
            <SituationCell io="rw" empty={!head.defaultTarget}>
              <Ladder
                levels={levels}
                caution={Boolean(health)}
                disabled={targetDisabled}
                title={
                  ladder.sessionWord
                    ? `${ladder.sessionWord} › ${ladder.docWord ?? "no document"}; pick to change`
                    : "choose a session and a document; Chat runs without one, Revit operations do not"
                }
              />
            </SituationCell>
            {refusal ? (
              <span className="ml-3 t-small" data-tone="caution">
                {refusal}
              </span>
            ) : null}
            {status ? (
              <span
                aria-live="polite"
                className="ml-3 t-small t-upper"
                data-tone={status.caution ? "caution" : undefined}
                data-testid="composer-status"
              >
                {status.text}
              </span>
            ) : null}
          </p>
        }
        trail={
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
        }
      />
      {status?.detail ? (
        <div
          role="alert"
          className="hairline-b px-2 py-1 t-small"
          data-testid="composer-status-detail"
          data-tone="caution"
        >
          {status.detail}
        </div>
      ) : null}
      <ProposalHead
        asks={approvals.map((approval) => (
          <div
            key={approval.toolCallId}
            className="flex flex-wrap items-baseline gap-3 py-0.5"
            data-tool-id={approval.toolCallId}
          >
            <span className="face-mono text-ink">⌗ {toolTitle(approval.toolName)}</span>
            {(() => {
              const call = callsById.get(approval.toolCallId);
              const target = call ? toolTarget(call.args) : undefined;
              return target ? (
                <code className="face-mono t-small text-ink" data-testid="approval-target">
                  {target}
                </code>
              ) : null;
            })()}
            {(() => {
              const call = callsById.get(approval.toolCallId);
              return call?.target && call.target !== toolTarget(call.args) ? (
                <span className="t-small truncate text-ink-2">{call.target}</span>
              ) : null;
            })()}
            <span className="t-small text-ink-2">{approval.kind}</span>
            {isParkedAsk(approval)
              ? // A live ask answers HERE: asks live in the head, the transcript holds records.
                (() => {
                  const question = readQuestion(approval.payload);
                  return question ? (
                    <AskUserPrompt
                      toolCallId={approval.toolCallId}
                      question={question}
                      resolve={resolveApproval}
                    />
                  ) : (
                    <span className="text-ink-2">the ask carries no question to answer</span>
                  );
                })()
              : APPROVAL_OPTIONS.map((option) => {
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
                })}
          </div>
        ))}
        works={works}
      />
    </section>
  );
}
