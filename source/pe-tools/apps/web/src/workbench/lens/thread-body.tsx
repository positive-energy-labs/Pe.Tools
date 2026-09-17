import { useAtomSuspense } from "@effect/atom-react";
import type * as Atom from "effect/unstable/reactivity/Atom";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type { ChatState } from "../chat-state";
import type { Mode } from "../depth";
import { Lens } from "./view";

/** The one suspended Chat region. Shell, flanks, and composer stay outside this body owner. */
export function ThreadBody({
  bodyAtom,
  state,
  mode,
  sideOpen,
}: {
  bodyAtom: Atom.Atom<AsyncResult.AsyncResult<ChatState, Error>>;
  state: ChatState;
  mode: Mode;
  sideOpen: boolean;
}) {
  useAtomSuspense(bodyAtom);
  return <Lens state={state} mode={mode} sideOpen={sideOpen} />;
}
