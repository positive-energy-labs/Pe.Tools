/** The Situation's document ladder, its picker, and the contexts Chat hands a hosted route. */
import { createContext, useContext, useEffect, useState } from "react";
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";
import { inventoryOf, previousOf } from "#/readings";
import { Ladder } from "./ladder";
import { useChooseTarget } from "./shell";
import type { ActionHandle, RouteHandle } from "./use-route";

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

/** The head's group drill-in: the hosted route narrows to the addresses under this path. */
export const ChatFocus = createContext<readonly string[] | null>(null);

export const ChatPlanIntent = createContext<{
  route: string;
  take: () => boolean;
  refused: (message: string) => void;
} | null>(null);

/**
 * session › document, read from the bridge inventory: titles and pe-revit ids, not GUIDs.
 * A pick moves the thread head (the one target store) and drops a `?target` pin, so the route
 * shows what the thread shows. A route with no thread still binds through `?target`; Chat's
 * composer hands in its own `binding`.
 */
export function useDocumentLadder(
  handle: RouteHandle<any, any, any, any>,
  onTarget?: () => void,
  binding?: {
    bound: { session: string; openId: string } | null;
    bind: (ref: { session: string; openId: string }) => void;
  },
) {
  const hosted = useContext(ChatHosted);
  const [pin, choose] = useChooseTarget();
  // The kernel's own inventory: a route need not declare an `inventory` Reading to show sessions.
  const inventory = handle.inventory;
  const observed = previousOf(inventory) as
    | { sessions?: readonly BridgeSessionListEntry[] }
    | undefined;
  const sessions = inventoryOf(observed?.sessions ?? []);
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
  const session = sessions.find((item) => item.sessionId === sessionId) ?? null;
  const doc = session?.openDocuments?.find((item) => item.openId === bound?.openId) ?? null;
  const note =
    inventory.state === "failed"
      ? inventory.message
      : inventory.state === "loading" && !sessions.length
        ? "reading sessions…"
        : undefined;
  const head = handle.head;
  const pick = (openId: string) => {
    if (!sessionId) return;
    onTarget?.();
    chooseSession(null);
    const ref = { session: sessionId, openId };
    if (binding) binding.bind(ref);
    else if (head)
      void head.set({ kind: "open", ref }).then((moved) => {
        if (moved && pin) choose(null);
      });
    else choose(JSON.stringify({ kind: "open", ref }));
  };
  const sessionWord = session ? (session.sdkSessionId ?? session.sessionId) : null;
  return {
    sessionWord,
    docWord: doc?.title ?? lost?.title ?? null,
    /** The bound document closed: the document word wears the caution tone. */
    lost: lost != null,
    /** The head's refusal of the last pick (stale head, or a Pea turn holding it). */
    refusal: binding ? null : (head?.refusal ?? null),
    hosted,
    levels: hosted
      ? []
      : [
          {
            key: "session",
            label: sessionWord,
            placeholder: "choose a session",
            options: sessions.map((item) => ({
              id: item.sessionId,
              label: item.sdkSessionId ?? item.sessionId,
              sub: `${item.openDocumentCount} open${item.lane ? ` · ${item.lane}` : ""}`,
            })),
            note: note ?? "no Revit answers the host",
            picked: (id: string) => id === sessionId,
            pick: chooseSession,
          },
          {
            key: "document",
            label: doc?.title ?? null,
            placeholder: "choose a document",
            options: session
              ? (session.openDocuments ?? [])
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
            note: session ? "nothing open here" : "choose a session first",
            picked: (id: string) => id === bound?.openId,
            pick,
          },
        ],
  };
}

/** The ladder's picker; hosted in Chat, only the bound document's word. */
export function LadderPicker({
  ladder,
  disabled,
}: {
  ladder: ReturnType<typeof useDocumentLadder>;
  disabled?: boolean;
}) {
  return ladder.hosted ? (
    <span data-tone={ladder.lost ? "caution" : undefined}>{ladder.docWord ?? "no document"}</span>
  ) : (
    <Ladder levels={ladder.levels} disabled={disabled} caution={ladder.lost} />
  );
}
