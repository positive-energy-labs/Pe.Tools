/** The Situation's document ladder, its picker, and the contexts Chat hands a hosted route. */
import { createContext, useContext, useEffect, useState } from "react";
import {
  machineAttachments,
  type MachineAttachment,
  type Machine,
  type Reading,
} from "@pe/agent-contracts";
import { useMachineSlice } from "#/machine/use-machine";
import { pidOf } from "#/machine/session";
import { previousOf } from "#/readings";
import { Ladder } from "./ladder";
import { useChooseTarget } from "./shell";
import type { ActionHandle, RouteHandle } from "./handle";

/**
 * True inside Chat's plugin pane. The pane's target is the thread head's, and Chat's composer head
 * is the one place to change it, so a hosted ladder offers no session or document levels.
 */
export const ChatHosted = createContext(false);

/**
 * Chat head's commit verb, handed to the hosted route (K3): the route named here runs its own
 * commit action once, in the pane, where its real confirmation sheet opens. `take` answers true
 * exactly once per press, so a remount never re-runs it. One-shot page state, never URL state.
 */
/**
 * Run the route's commit once when Chat's head asked for it and this route's Work is read.
 * Refusals are the action's own: they land in the route's page log, and go back to the head
 * where plan was pressed (F-B-5).
 */
export function useChatPlanIntent(
  handle: Pick<RouteHandle<any, any, any, any>, "manifest" | "work">,
  commit: ActionHandle | undefined,
) {
  const intent = useContext(ChatPlanIntent);
  // A route with Work plans what it read; one without has nothing to wait for.
  const intended =
    intent?.route === handle.manifest.key && (handle.work.current || !handle.manifest.work);
  useEffect(() => {
    if (intended && commit && intent.take())
      void commit.run().then((refusal) => refusal && intent.refused(refusal.message));
  }, [intended, intent, commit]);
}

export const ChatPlanIntent = createContext<{
  route: string;
  take: () => boolean;
  refused: (message: string) => void;
} | null>(null);

/**
 * session › document, read from Machine: titles and pe-revit ids, not GUIDs.
 * A route pick writes only that tool's `?target`; it never moves a conversation's targets. A lost
 * pin stays its old Work and offers an explicit choice; nothing rebinds it automatically. Chat's
 * composer hands in its own `binding`: a multi-select that toggles the thread's targets.
 */
export function useDocumentLadder(
  handle: RouteHandle<any, any, any, any>,
  onTarget?: () => void,
  binding?: {
    bound: { session: string; openId: string } | null;
    /** Every exact open document the thread targets; the rung checks each. */
    targets: readonly { session: string; openId: string }[];
    bind: (ref: { session: string; openId: string }) => void;
  },
) {
  const hosted = useContext(ChatHosted);
  const [, choose] = useChooseTarget();
  const inventory = useMachineSlice((shared) => {
    const reading = (handle.readings.machine as Reading<Machine> | undefined) ?? shared;
    const observed = previousOf(reading);
    return {
      state: reading.state,
      message: reading.state === "failed" ? reading.message : undefined,
      sessions: (observed ? machineAttachments(observed) : []).map((attachment) => {
        const session = observed?.revit.sessions?.find(
          (s) => s.attachment?.session === attachment.session,
        );
        return {
          ...attachment,
          label:
            session && session.row.case !== "observed-active"
              ? session.row.id
              : `Revit · pid ${attachment.pid}`,
          allowed: session?.row.execution?.allowed === true,
        };
      }),
      unloaded: (observed?.revit.sessions ?? [])
        .filter(
          (item) =>
            (item.row.case === "observed-active" || item.row.case === "controlled-active") &&
            (item.attachment ? item.attachment.documents === null : item.documents?.length !== 0),
        )
        .map((item) => pidOf(item.row)),
    };
  });
  const { sessions, unloaded } = inventory;
  const name = (attachment: MachineAttachment) =>
    sessions.find((s) => s.session === attachment.session)!.label;
  const bound = binding
    ? binding.bound
    : handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const [chosenSession, chooseSession] = useState<string | null>(null);
  // A binding whose document closed still names its session, so the ladder can offer the same
  // title reopened there as its first row (F-X-1). Never taken for the person.
  const lost = binding ? null : handle.bindingLost;
  const sessionId = chosenSession ?? bound?.session ?? lost?.ref.session ?? null;
  const session = sessions.find((item) => item.session === sessionId) ?? null;
  const doc = session?.documents?.find((item) => item.openId === bound?.openId) ?? null;
  const note =
    inventory.state === "failed"
      ? inventory.message
      : inventory.state === "loading" && !sessions.length
        ? "reading sessions…"
        : undefined;
  const pick = (openId: string) => {
    if (!sessionId) return;
    onTarget?.();
    chooseSession(null);
    const ref = { session: sessionId, openId };
    if (binding) binding.bind(ref);
    else choose(JSON.stringify({ kind: "open", ref }));
  };
  const sessionWord = session ? name(session) : null;
  const notLoaded = "Pe.Tools is not loaded in this Revit. Finish the install, then restart Revit.";
  return {
    sessionWord,
    docWord:
      binding && binding.targets.length > 1
        ? `${binding.targets.length} documents`
        : (doc?.title ?? lost?.title ?? null),
    /** The bound document closed: the document word wears the caution tone. */
    lost: lost != null,
    refusal: null,
    hosted,
    /** No pin: the read-only fallback to the machine's sole user document; said quietly in the sentence. */
    autoBound: handle.targetProvenance?.source === "sole-document" && bound != null,
    levels: hosted
      ? []
      : [
          {
            key: "session",
            label: sessionWord,
            placeholder: "choose a session",
            options: sessions.map((item) => ({
              id: item.session,
              label: name(item),
              refusal: !item.allowed ? "Runtime ownership is not verified" : undefined,
              sub: item.documents === null ? "documents unknown" : `${item.documents.length} open`,
            })),
            note: note ?? "no Revit answers the host",
            extra: unloaded.length ? (
              <div className="grid gap-1 px-2 py-1">
                {unloaded.map((item) => (
                  <div key={item}>
                    <div className="face-mono">Revit · pid {item}</div>
                    <div aria-disabled="true" data-tone="caution">
                      {notLoaded}
                    </div>
                  </div>
                ))}
              </div>
            ) : undefined,
            picked: (id: string) => id === sessionId,
            pick: chooseSession,
          },
          {
            key: "document",
            label: doc?.title ?? null,
            placeholder: "choose a document",
            options: session
              ? (session.documents ?? [])
                  .map((item) => ({
                    id: item.openId,
                    label: item.title,
                    sub:
                      item.openId === lost?.reopened?.openId
                        ? "reopened — the document this page was bound to, under a new openId"
                        : item.isFamilyDocument
                          ? "family"
                          : "project",
                  }))
                  .sort(
                    (a, b) =>
                      Number(b.id === lost?.reopened?.openId) -
                      Number(a.id === lost?.reopened?.openId),
                  )
              : null,
            note: session
              ? session.documents === null
                ? notLoaded
                : "nothing open here"
              : "choose a session first",
            picked: (id: string) => id === bound?.openId,
            ...(binding
              ? {
                  multi: true,
                  checked: (id: string) =>
                    binding.targets.some(
                      (target) => target.session === sessionId && target.openId === id,
                    ),
                }
              : {}),
            pick,
          },
        ],
  };
}

/** The ladder's picker; hosted in Chat, only the bound document's word. */
export function LadderPicker({
  ladder,
  disabled,
  open,
  onOpenChange,
}: {
  ladder: ReturnType<typeof useDocumentLadder>;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return ladder.hosted ? (
    <span data-tone={ladder.lost ? "caution" : undefined}>{ladder.docWord ?? "no document"}</span>
  ) : (
    <>
      <Ladder
        levels={ladder.levels}
        disabled={disabled}
        caution={ladder.lost}
        open={open}
        onOpenChange={onOpenChange}
      />
      {ladder.autoBound ? <span className="text-ink-2"> (the only open document)</span> : null}
    </>
  );
}
