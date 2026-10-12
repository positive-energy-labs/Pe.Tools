import { useAtomSuspense } from "@effect/atom-react";
import type * as Atom from "effect/unstable/reactivity/Atom";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type { ChatState, ThreadBody } from "../chat-state";
import { Lens } from "./view";

/** The one suspended Chat region. Shell, flanks, and composer stay outside this body owner. */
export function ThreadBody({
  bodyAtom,
  state,
}: {
  bodyAtom: Atom.Atom<AsyncResult.AsyncResult<ThreadBody, Error>>;
  state: ChatState;
}) {
  useAtomSuspense(bodyAtom);
  return <Lens state={state} />;
}
