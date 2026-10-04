/**
 * THE COMPOSER HEAD — Chat's whole Situation (design-system ledger, 2026-09-13). Chat has no
 * route head: "Pea on project-a" with the document's health, a document-only target bound through
 * the thread head (`PUT /scope/:thread`; a `?target` pin seeds a document-less thread once), Send as the one verb with the
 * Situation's flag, and Pea's proposals as the Work band under the verb row, so approve and
 * reject have one location and the stream stays a record.
 */
import { useEffect, useRef } from "react";
import { resolveCallTarget, toolTitle, type TargetResolution } from "@pe/agent-contracts";
import { ArrowDown, X } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { PopupFrame } from "#/components/lang/list-popup";
import { useAtomValue } from "@effect/atom-react";

import { ActionButton } from "#/components/lang/action-button";
import { Press } from "#/components/lang/press";
import { Rail } from "#/components/lang/rail";
import { targetInventory } from "#/readings";
import { Ladder } from "#/route/ladder";
import { Ledger, PageLog } from "#/route/situation-grids";
import { useDocumentLadder } from "#/route/situation-ladder";
import { Cluster } from "#/route/situation-lamp";
import { SituationCell } from "#/route/situation-marks";
import { parseTarget } from "#/route/route-target";
import type { ActionHandle, RouteHandle } from "#/route/use-route";
import type { ChatReading, ChatActionKey } from "#/chat/manifest";
import { useThreadScope } from "#/chat/scope";
import type { ChatPage } from "#/chat/seeds";
import {
  selectApprovals,
  selectPlan,
  selectRunStatus,
  selectTitle,
  selectToolCalls,
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

/** What both the composer head and the thread head's cluster read: the thread's target and its
 *  health. Called ONCE per surface (ChatSurface) and handed to both. */
export function useChatSituation(handle: ChatHandle) {
  const { currentThreadId, threads, chat, missingThread } = useWorkbench();
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
  const health = head.defaultTarget ? complaint(resolution) : null;
  // A thread the host does not know names nothing: the transcript says "no such thread".
  const threadLabel = missingThread
    ? ""
    : selectTitle(chat) ||
      threads.find((item) => item.id === currentThreadId)?.title ||
      currentThreadId;
  return { head, inventory, bound, ladder, health, threadLabel };
}

export type ChatSituation = ReturnType<typeof useChatSituation>;

/** Lamp · gauge · help · theme for Chat — it rides the thread head, not the composer. */
export function ChatCluster({
  handle,
  situation: { head, threadLabel },
}: {
  handle: ChatHandle;
  situation: ChatSituation;
}) {
  return (
    <Cluster
      handle={handle}
      // No lamp: the composer sentence names the target, and a hosted route draws its own.
      lamp={null}
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
          <PageLog entries={handle.log} manifest={handle.manifest} />
        </>
      }
    />
  );
}

export function ComposerHead({
  handle,
  situation,
  status,
  urlTarget,
}: {
  /** The URL's `?target` pin: a thread with no document takes it once (e2e finding 7). */
  urlTarget?: string;
  handle: ChatHandle;
  situation: ChatSituation;
  /** Thread-level loading/failure. It lives HERE, not in a rail above the transcript: the
   * Situation already answers "what is bound and how is it", and a rail that appears and
   * disappears over the chat shifted the whole lane every time it spoke. */
  status?: { text: string; caution: boolean; detail?: string };
}) {
  const { currentThreadId, threads, chat, missingThread, openThread, resolveApproval, store } =
    useWorkbench();
  const isRunning = selectRunStatus(chat) !== "idle";
  const { head, inventory, bound, ladder, health, threadLabel } = situation;
  const refusal =
    head.refusal ?? (handle.outcome?.key === "send" ? handle.outcome.refusal?.message : null);
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
  // Live asks only: an expired ask is a transcript record, never a head row.
  const approvals = selectApprovals(chat);
  const works = useHeadWorks(documentAddress(inventory, bound), ladder.docWord ?? "document", {
    open: store.actions.setPlugin,
    planIn: store.actions.planIn,
    planRefusal: useAtomValue(store.atoms.planRefusal),
  });
  // "Do" alone says nothing about what is being asked for: the ask row names the call's target.
  const callsById = new Map(selectToolCalls(chat).map((call) => [call.id, call]));
  const selectedThread = threads.find((item) => item.id === currentThreadId);
  const threadOptions =
    selectedThread || missingThread
      ? threads
      : [{ id: currentThreadId, title: currentThreadId, updatedAt: "" }, ...threads].filter(
          (thread) => thread.id,
        );
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
          <span className="flex shrink-0 items-center gap-3">
            <PlanChip tasks={selectPlan(chat)} />
            <Press
              tone="quiet"
              size="icon"
              title="Jump to the latest turn"
              aria-label="Jump to latest"
              onClick={() => window.dispatchEvent(new Event("pe:focus-tail"))}
            >
              <ArrowDown className="size-4" />
            </Press>
          </span>
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
        asks={approvals.map((approval) => {
          const call = callsById.get(approval.toolCallId);
          return (
            <div
              key={approval.requestId}
              className="flex flex-wrap items-baseline gap-3 py-0.5"
              data-tool-id={approval.toolCallId}
            >
              <span className="face-mono text-ink">⌗ {toolTitle(approval.toolName)}</span>
              {call?.target ? (
                <code className="face-mono t-small text-ink" data-testid="approval-target">
                  {call.target}
                </code>
              ) : null}
              <div className="hairline-y hairline-rows flex w-full min-w-0 flex-col [&>button]:w-full">
                {approval.options.map((option, index) => (
                  <Press
                    key={option.optionId}
                    size="value"
                    aria-label={option.name}
                    data-kind={option.kind}
                    onClick={() => void resolveApproval(approval.requestId, option.optionId)}
                  >
                    <span className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2 px-2 py-1.5 text-left">
                      <span aria-hidden="true" className="face-mono text-ink-2">
                        {index + 1}.
                      </span>
                      <span className="min-w-0">
                        <span className="block">{option.name}</span>
                        <span
                          className="mt-0.5 block t-small text-ink-2"
                          data-tone={option.kind === "allow_always" ? "caution" : undefined}
                        >
                          {VERDICT[option.kind]}
                        </span>
                      </span>
                    </span>
                  </Press>
                ))}
              </div>
            </div>
          );
        })}
        works={works}
      />
    </section>
  );
}

/** What each ACP permission option kind covers, said under the harness's own option name. From
 *  the kind only, in neutral words: the call may be a file write, a command, or a Pea door. */
const VERDICT = {
  allow_once: "this call only",
  allow_always: "every call of this kind in this session, beyond this thread",
  reject_once: "refuse",
  reject_always: "refuse every call of this kind in this session, beyond this thread",
} as const;

type PlanTask = ReturnType<typeof selectPlan>[number];

/** Pea's plan as one `plan x/y` press in the cluster; the list opens over the lane, never adding
 *  height to the head. Nothing when pea has no plan. */
function PlanChip({ tasks }: { tasks: readonly PlanTask[] }) {
  if (tasks.length === 0) return null;
  const done = tasks.filter((task) => task.status === "completed").length;
  return (
    <Popover.Root>
      <Popover.Trigger
        render={<Press tone="quiet" size="caption" />}
        title="Pea's plan for this run"
      >
        <span className="face-mono">
          plan {done}/{tasks.length}
        </span>
      </Popover.Trigger>
      <PopupFrame side="top" align="end" label="Pea's plan for this run">
        <div className="grid max-h-(--available-height) w-[32rem] overflow-auto p-1.5 t-small text-ink-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="grid grid-cols-[12px_minmax(0,1fr)] gap-1 px-1 py-0.5"
              data-status={task.status}
            >
              <span data-tone={task.status === "completed" ? "done" : undefined}>
                {task.status === "completed" ? "✓" : task.status === "in_progress" ? "▸" : "○"}
              </span>
              <span className={task.status === "in_progress" ? "text-ink" : undefined}>
                {task.content}
              </span>
            </div>
          ))}
        </div>
      </PopupFrame>
    </Popover.Root>
  );
}
