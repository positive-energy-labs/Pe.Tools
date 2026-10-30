import { actionScopeKeys, type ActionDefinition, type Chord, type ScopeKey } from "@pe/kit/keys";
import type { RouteHandle } from "./handle";

type AnyHandle = RouteHandle<any, any, any, any>;

const actionKey = (handle: AnyHandle, name: string, hotkey: Chord): ScopeKey => {
  const action = handle.actions[name]!;
  const definition: ActionDefinition = {
    id: `route.${handle.manifest.key}.${name}`,
    label: action.label,
    description: action.says,
    bindings: [hotkey],
    refusal: action.refusal,
    invoke: () => void action.run(),
  };
  return actionScopeKeys([definition])[0]!;
};

/** The route node's chords: every manifest action that declares one. */
export const manifestChords = (handle: AnyHandle): ScopeKey[] =>
  Object.entries(handle.actions)
    .filter(([, action]) => action.chord !== undefined)
    .map(([name, action]) => actionKey(handle, name, action.chord as Chord));
