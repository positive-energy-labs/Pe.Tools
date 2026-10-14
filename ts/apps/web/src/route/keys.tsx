import type { Chord, ScopeKey } from "@pe/kit/keys";
import type { RouteHandle } from "./handle";

type AnyHandle = RouteHandle<any, any, any, any>;

const actionKey = (handle: AnyHandle, name: string, hotkey: Chord): ScopeKey => {
  const action = handle.actions[name]!;
  return {
    hotkey,
    label: action.label,
    says: action.says,
    refusal: action.refusal,
    callback: () => void action.run(),
  };
};

/** The route node's chords: every manifest action that declares one. */
export const manifestChords = (handle: AnyHandle): ScopeKey[] =>
  Object.entries(handle.actions)
    .filter(([, action]) => action.chord !== undefined)
    .map(([name, action]) => actionKey(handle, name, action.chord as Chord));

/**
 * The stage node's chords: a stage owns them (`route/stage.ts`, `StageDecl.keys`) and the manifest
 * carries none, so a chord bound in one stage is dead the moment another stage draws.
 */
export const stageChords = (
  handle: AnyHandle,
  keys: Readonly<Record<string, Chord | undefined>>,
): ScopeKey[] =>
  Object.entries(keys).flatMap(([name, hotkey]) =>
    hotkey === undefined ? [] : [actionKey(handle, name, hotkey)],
  );
