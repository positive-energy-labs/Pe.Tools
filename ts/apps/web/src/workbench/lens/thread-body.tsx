import { useAtomSuspense, useAtomValue } from "@effect/atom-react";
import type * as Atom from "effect/reactivity/Atom";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import type { ChatState, ThreadBody } from "@pe/agent-contracts/chat-state";
import { Lens } from "./view";

/** The one suspended Chat region. Shell, flanks, and composer stay outside this body owner. */
export function ThreadBody({
  bodyAtom,
  stateAtom,
}: {
  bodyAtom: Atom.Atom<AsyncResult.AsyncResult<ThreadBody, Error>>;
  stateAtom: Atom.Atom<ChatState>;
}) {
  useAtomSuspense(bodyAtom);
  const state = useAtomValue(stateAtom);
  return <Lens state={state} />;
}
