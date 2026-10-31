import type { PaneDecl, RouteGraph, RouteGraphRefusal, VerbDecl } from "@pe/agent-contracts";
import { actionScopeKeys, type ActionDefinition, type Chord, type ScopeKey } from "@pe/kit/keys";

export interface KeyScopeSpec {
  id: string;
  keys: readonly ScopeKey[];
  children: readonly KeyScopeSpec[];
}

export interface GraphChordPlacements {
  /** Only panes in the reduced, mounted layout appear here. Folded panes bind nothing. */
  panes: Readonly<Record<string, { folded?: boolean; verbs?: readonly string[] }>>;
  /** Invocation and admission come from the verb owner; labels and chords come from the graph. */
  actions: Readonly<Record<string, Pick<ActionDefinition, "invoke" | "available" | "refusal">>>;
}

export type GraphChordRefusal = Omit<RouteGraphRefusal, "code"> & {
  code: RouteGraphRefusal["code"] | "reserved-chord";
};

const chordParts = (chord: string) =>
  chord
    .toLowerCase()
    .split("+")
    .map((part) => part.trim());
const CHORD_ALIASES: Readonly<Record<string, string>> = {
  control: "ctrl",
  cmd: "meta",
  command: "meta",
  option: "alt",
};
const chordKey = (chord: string) =>
  chordParts(chord)
    .map((part) => CHORD_ALIASES[part] ?? part)
    .sort()
    .join("+");
// Explicit platform spellings must not bypass reservations of the same physical keys.
const RESERVED = new Set(
  ["Mod", "Ctrl", "Meta"].flatMap((mod) =>
    ["Z", "Shift+Z", "Y", "K", "Shift+K"].map((key) => chordKey(`${mod}+${key}`)),
  ),
);

/** Bare and Shift-only keys belong to text controls. Modified commands remain available there. */
export const chordIgnoresInputs = (chord: string): boolean =>
  !chordParts(chord).some((part) =>
    ["mod", "ctrl", "control", "meta", "cmd", "command", "alt", "option"].includes(part),
  );

const placedIds = (pane: PaneDecl): readonly string[] =>
  typeof pane.verbs === "function" ? pane.verbs.ids : pane.verbs;

function paneChords(
  graph: { verbs: Readonly<Record<string, VerbDecl>> },
  pane: PaneDecl,
  ids = placedIds(pane),
) {
  return ids.flatMap((id) =>
    [
      ...new Set(
        [graph.verbs[id]?.chord, pane.chords?.[id]].filter((chord): chord is string => !!chord),
      ),
    ].map((chord) => ({ id, chord })),
  );
}

/** Admission checks all declarations, including panes that are currently gated or folded. */
export function validateGraphChords<P, W>(graph: RouteGraph<P, W>): GraphChordRefusal[] {
  const refusals: GraphChordRefusal[] = [];
  const reserved = (chord: string, path: string) => {
    if (RESERVED.has(chordKey(chord)))
      refusals.push({
        code: "reserved-chord",
        path,
        message: `'${chord}' is reserved by the shell`,
      });
  };
  for (const [id, verb] of Object.entries(graph.verbs))
    if (verb.chord) reserved(verb.chord, `verbs.${id}.chord`);
  for (const [paneId, pane] of Object.entries(graph.panes)) {
    for (const [id, chord] of Object.entries(pane.chords ?? {})) {
      reserved(chord, `panes.${paneId}.chords.${id}`);
      if (!Object.hasOwn(graph.verbs, id) || !placedIds(pane).includes(id))
        refusals.push({
          code: "missing-verb",
          path: `panes.${paneId}.chords.${id}`,
          message: `Pane '${paneId}' does not place verb '${id}'`,
        });
    }
    const used = new Map<string, string>();
    for (const { id, chord } of paneChords(graph, pane)) {
      const prior = used.get(chordKey(chord));
      if (prior && prior !== id)
        refusals.push({
          code: "chord-conflict",
          path: `panes.${paneId}.chords`,
          message: `'${prior}' and '${id}' share '${chord}' in pane '${paneId}'`,
        });
      used.set(chordKey(chord), id);
    }
  }
  return refusals;
}

export type GraphChordBinding =
  | { ok: true; tree: KeyScopeSpec }
  | { ok: false; refusals: readonly GraphChordRefusal[] };

/** Pure projection for kit KeyScope + ScopeKeys. It registers no second scope tree or hotkey door. */
export function bindGraphChords<P, W>(
  graph: RouteGraph<P, W>,
  stage: string,
  placements: GraphChordPlacements,
): GraphChordBinding {
  const refusals = validateGraphChords(graph);
  const declared = graph.stages[stage];
  if (!declared)
    refusals.push({
      code: "invalid-graph",
      path: `stages.${stage}`,
      message: `Unknown stage '${stage}'`,
    });
  for (const id of declared?.panes ?? []) {
    const pane = graph.panes[id];
    const resolved = placements.panes[id]?.verbs;
    if (pane && resolved?.some((verb) => !placedIds(pane).includes(verb)))
      refusals.push({
        code: "missing-verb",
        path: `panes.${id}.verbs`,
        message: `Pane '${id}' resolved an undeclared verb`,
      });
  }
  if (refusals.length || !declared) return { ok: false, refusals };
  const keys = (bindings: readonly { id: string; chord: string }[]): ScopeKey[] =>
    bindings.flatMap(({ id, chord }) => {
      const verb = graph.verbs[id];
      const action = placements.actions[id];
      if (!verb || !action) return [];
      return actionScopeKeys([
        {
          ...action,
          id: `route.${graph.key}.${id}`,
          label: verb.label,
          description: verb.says,
          bindings: [chord as Chord],
          options: { ignoreInputs: chordIgnoresInputs(chord) },
        },
      ]);
    });
  return {
    ok: true,
    tree: {
      id: graph.key,
      keys: [],
      children: [
        {
          id: `${graph.key}:${stage}`,
          keys: keys(
            declared.verbs.flatMap((id) =>
              graph.verbs[id]?.chord ? [{ id, chord: graph.verbs[id]!.chord! }] : [],
            ),
          ),
          children: declared.panes.flatMap((id) => {
            const placement = placements.panes[id];
            const pane = graph.panes[id];
            if (!pane || !placement || placement.folded) return [];
            const ids = placement.verbs ?? placedIds(pane);
            return [{ id, keys: keys(paneChords(graph, pane, ids)), children: [] }];
          }),
        },
      ],
    },
  };
}
