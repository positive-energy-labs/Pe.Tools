import { useEffect, useMemo, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { FamilyStore } from "#/family/store";
import {
  consumersOf,
  agreementOf,
  bindingOf,
  effective,
  ghostRows,
  isUnsavedAt,
  paramNameFor,
  paramsInFocus,
  partsInFocus,
  type Draft,
  type Focus,
  type PRow,
} from "#/family/model";
import type { ProtoProposal } from "#/family/world";

export function useFamilyWorkspaceCore(store: FamilyStore) {
  const profile = useAtomValue(store.atoms.profile);
  const stage = useAtomValue(store.atoms.routeStage);
  /** WHICH LANE — the one question that separates them, asked once (see `#/family/lane`). */
  const lane = useAtomValue(store.atoms.lane);
  const world = lane.world;
  /**
   * The last-read document, as a draft. It is the page's record of the DISK and the baseline the
   * reverse projection diffs against — so a save writes what moved and nothing else, and a draft
   * back at its baseline honestly has nothing to save.
   */
  const draft = useAtomValue(store.atoms.draft);
  const setDraft = store.actions.setDraft;
  /** THE PSEUDO-DIMENSION. PAGE state, never the URL: which reading you are looking through is not
   * a place, and a link that restored someone else's overlay would be claiming it is. Draft is the
   * default because it is the only one you can work in. */
  const overlay = useAtomValue(store.atoms.overlay);
  const setOverlay = store.actions.setOverlay;
  /** The disk, per cell. Seeded from the document — it starts saved — and re-snapshotted on save. */
  const saved = useAtomValue(store.atoms.saved);
  /** Table state is OWNED here, because the sort direction is an input to the ghost-pinning
   * workaround — the sort key has to know which way it is about to be read. */
  const tableState = useAtomValue(store.atoms.table);
  const setTableState = store.actions.setTable;
  const drillState = useAtomValue(store.atoms.drill);
  const setDrillState = store.actions.setDrill;
  const docMode = useAtomValue(store.atoms.docMode);
  const setDocMode = store.actions.setDocMode;
  const docZoom = useAtomValue(store.atoms.docZoom);
  const setDocZoom = store.actions.setDocZoom;
  const drillType = useAtomValue(store.atoms.drillType);
  const setDrillType = store.actions.setDrillType;
  const stageType = useAtomValue(store.atoms.stageType);
  const setStageType = store.actions.setStageType;
  const focus = useAtomValue(store.atoms.focus);
  const setFocus = store.actions.setFocus;
  const focusedProposal = useAtomValue(store.atoms.focusedProposal);
  const setFocusedProposal = store.actions.setFocusedProposal;
  /** The row whose proposals were last LOCATED from the table. Sticky — hover comes and goes, but
   * "I clicked this row's rail dot" has to survive the pointer leaving the row on its way to the
   * sidebar, or the cards would go dark exactly as you reached for them. */
  const pinnedParam = useAtomValue(store.atoms.pinnedParam);
  const setPinnedParam = store.actions.setPinnedParam;
  const anatomyCollapsed = useAtomValue(store.atoms.anatomyCollapsed);
  const setAnatomyCollapsed = store.actions.setAnatomyCollapsed;
  const target = useAtomValue(store.atoms.target);
  /**
   * What the doc pane's LOWER HALF is showing. One slot, two subjects: a constituent's
   * non-bindable metadata, or a parameter's family-level value. They share the slot because they
   * are the same question asked twice — "what is true of this thing itself, rather than of it at
   * some type" — and because a page with two inspectors has no answer to which one you meant.
   */
  const inspect = useAtomValue(store.atoms.inspect);
  const setInspect = store.actions.setInspect;
  /** The ghost row whose bind picker is open. One at a time; picking or cancelling closes it. */
  const binding = useAtomValue(store.atoms.binding);
  const setBinding = store.actions.setBinding;
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const say = store.actions.say;

  // Esc unwinds ONE thing, innermost first: the bind picker, then the inspector, then the
  // drill-in. Each is a mode of a pane rather than a place, so leaving one must never feel like
  // navigating — and collapsing them all at once would throw away context you did not ask to lose.
  useEffect(() => {
    if (drillType == null && inspect == null && binding == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (binding != null) setBinding(null);
      else if (inspect != null) setInspect(null);
      else setDrillType(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drillType, inspect, binding]);

  // Locating scrolls the card into the sidebar. That is the whole payoff of the rail and the
  // corner folds: the table points, the sidebar decides, and nothing covers the table.
  useEffect(() => {
    if (!focusedProposal) return;
    cardRefs.current[focusedProposal]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedProposal]);

  /** A proposal STANDS until it is cleared. Accepting does not clear it: the reader wants it
   * behind the staged value, because that is the only evidence that the square is pea's ink. */
  const stands = (entry: ProtoProposal): boolean => !draft.cleared.includes(entry.id);

  /**
   * WHAT BECAME OF PEA'S READING — derived from the draft, never remembered.
   *   cleared — denied, or beaten by your own edit. Gone; the cell shows the real value.
   *   taken   — the draft now STAGES exactly what it argued for. That is what accept does, and
   *             typing the same number yourself is indistinguishable, which is honest.
   *   open    — still owed a decision.
   */
  const proposalState = (entry: ProtoProposal): "open" | "taken" | "cleared" => {
    if (!stands(entry)) return "cleared";
    const value = entry.typeName
      ? draft.types[entry.typeName]?.[entry.param]
      : draft.authored[entry.param];
    const disk = entry.typeName
      ? saved.types[entry.typeName]?.[entry.param]
      : saved.authored[entry.param];
    return value === entry.proposed && value !== disk ? "taken" : "open";
  };

  /** Every standing proposal aimed at exactly one cell: a type override, or the family-level
   * value. A list, not a single one — a cell may be argued about twice, and hiding the second
   * would be the surface lying about how much is outstanding. */
  const proposalsAt = (param: string, typeName: string | null): ProtoProposal[] =>
    world.proposals.filter(
      (entry) => entry.param === param && (entry.typeName ?? null) === typeName && stands(entry),
    );

  /** Every standing proposal anywhere on a parameter's row — what the RAIL counts. */
  const proposalsOn = (param: string): ProtoProposal[] =>
    world.proposals.filter((entry) => entry.param === param && stands(entry));

  const openProposals = world.proposals.filter((entry) => stands(entry));

  /** Locate: point the sidebar at a proposal without deciding anything about it. */
  const locate = (proposal: ProtoProposal) => {
    setFocusedProposal(proposal.id);
    setPinnedParam(proposal.param);
  };

  /**
   * The table's rows, DERIVED from the draft rather than fixed at module load — because two of
   * this surface's verbs change the row set itself. Promoting a literal adds a parameter row and
   * removes a ghost in the same edit, and that move is the only proof the user gets that binding
   * did anything at all.
   */
  const rows = useMemo<PRow[]>(
    () => [
      ...world.paramRows,
      ...draft.newParams.map((param) => ({
        key: param.name,
        name: param.name,
        dataType: param.dataType,
        group: param.group,
        isInstance: false,
        kind: "profile" as const,
      })),
      // live-only rows exist only while the LIVE overlay is on. They are rows with no draft and no
      // saved value — under `draft` every cell of them would be a blank refusal, and a row that can
      // only ever say "not here" is a row the table is better off not carrying. Under the live
      // overlay they are the other half of the reconcile: what Revit has that the profile does not.
      ...(overlay === "live" ? world.liveOnlyRows : []),
      ...ghostRows(world, draft),
    ],
    [world, draft, overlay],
  );

  const consumers = useMemo(() => consumersOf(world, draft), [world, draft]);
  const ghostCount = rows.filter((row) => row.kind === "ghost").length;

  const driftCells = useMemo(() => {
    const cells: { param: string; typeName: string }[] = [];
    for (const row of rows) {
      for (const typeName of world.typeNames) {
        if (agreementOf(world, draft, row, typeName) === "drift")
          cells.push({ param: row.name, typeName });
      }
    }
    return cells;
  }, [world, draft, rows]);

  /** How many value cells the draft would write into the file. The header's dirty fact says
   * WHETHER; this says HOW MUCH, and the caution squares say WHERE. */
  const unsavedCount = useMemo(() => {
    let count = 0;
    for (const row of rows)
      for (const typeName of world.typeNames) {
        if (row.kind === "ghost" && typeName !== world.typeNames[0]) continue; // one merged cell, one count
        if (isUnsavedAt(world, draft, saved, row, typeName)) count += 1;
      }
    return count;
  }, [world, draft, saved, rows]);

  // ── verbs ─────────────────────────────────────────────────────────────────────────────────────

  const accept = (proposal: ProtoProposal) => {
    setDraft((previous) => {
      const next = structuredClone(previous);
      if (proposal.typeName) {
        next.types[proposal.typeName] = {
          ...next.types[proposal.typeName],
          [proposal.param]: proposal.proposed,
        };
      } else {
        next.authored[proposal.param] = proposal.proposed;
      }
      next.dirty = true;
      return next;
    });
    say(`accepted ${proposal.param} = ${proposal.proposed}`);
  };

  /** DENY CLEARS. There is no denied state to draw: the proposal stops standing, so the cell goes
   * back to showing the real value and draws nothing. The card keeps a one-line record with a
   * re-open verb, which is the whole undo — the proposal itself never left this page. */
  const deny = (proposal: ProtoProposal) => {
    setDraft((previous) => ({ ...previous, cleared: [...previous.cleared, proposal.id] }));
    say(`denied — the proposal is gone and ${proposal.param} shows its real value again`);
  };

  /** Put a cleared proposal back. Page-scoped view state, not a cell state. */
  const reopen = (proposal: ProtoProposal) => {
    setDraft((previous) => ({
      ...previous,
      cleared: previous.cleared.filter((id) => id !== proposal.id),
    }));
    say(`re-opened pea's reading of ${proposal.param}`);
  };

  /**
   * TYPING BEATS PROPOSING. Committing your own value into a cell CLEARS every proposal aimed at
   * that exact cell — including an empty commit, which hands the type back to inheriting and is
   * just as much a decision. `superseded` was a fourth state for this, and it is deleted: pea
   * argued for a number and you wrote a different one, so the proposal is simply gone, exactly as
   * a denial leaves it. The card says which of the two happened; the cell has nothing to say.
   */
  const sever = (next: Draft, param: string, typeName: string | null) => {
    for (const entry of world.proposals) {
      if (entry.param !== param) continue;
      if ((entry.typeName ?? null) !== typeName) continue;
      if (next.cleared.includes(entry.id)) continue;
      next.cleared.push(entry.id);
    }
  };

  /**
   * The FAMILY-LEVEL value. The type columns show it only as a grey placeholder they inherit, and
   * a placeholder is not an editor; it lives in the inspector, which is also the only place a
   * formula can be typed at a comfortable width. Committing here severs a family-level proposal
   * exactly as typing in a type cell severs a per-type one — the law does not care which level you
   * beat pea to.
   */
  const editAuthored = (param: string, value: string): string | void => {
    const trimmed = value.trim();
    // A parameter with no family value is not a state — but a REFUSAL has to be audible. A silent
    // dropped commit looks exactly like an edit that landed and then vanished. Returning the
    // reason REFUSES the commit in the editable `StateCell` (R8): the cell restores the prior
    // value and wears the dismissible caution note; the header receipt says it too, so the
    // refusal survives the note being dismissed.
    if (trimmed === "") {
      const text = `Refused — "${param}" cannot have an empty family value. Every type inherits it; clearing it would leave ${world.typeNames.length} types resolving to nothing. To make one type differ, override it in that type's cell instead.`;
      say(text);
      return text;
    }
    setDraft((previous) => {
      const next = structuredClone(previous);
      next.authored[param] = trimmed;
      sever(next, param, null);
      next.dirty = true;
      return next;
    });
  };

  const editOverride = (param: string, typeName: string, value: string) =>
    setDraft((previous) => {
      const next = structuredClone(previous);
      const bucket = { ...next.types[typeName] };
      if (value.trim() === "") delete bucket[param];
      else bucket[param] = value.trim();
      next.types[typeName] = bucket;
      sever(next, param, typeName);
      next.dirty = true;
      return next;
    });

  /** capture — Revit wins. Writes live values into the profile as per-type overrides, dropping an
   * override that would merely restate the family value. Revit is not touched.
   * `only` narrows it to one parameter, so a per-row verb does exactly what its label says. */
  const capture = (types: string[], only?: string) =>
    setDraft((previous) => {
      const next = structuredClone(previous);
      let moved = 0;
      for (const row of rows) {
        if (row.kind !== "profile") continue;
        if (only !== undefined && row.name !== only) continue;
        for (const typeName of types) {
          if (agreementOf(world, previous, row, typeName) !== "drift") continue;
          const value = next.live[row.name]?.[typeName]?.value;
          if (value == null) continue;
          const bucket = { ...next.types[typeName] };
          if (value === next.authored[row.name]) delete bucket[row.name];
          else bucket[row.name] = value;
          next.types[typeName] = bucket;
          moved += 1;
        }
      }
      next.dirty = next.dirty || moved > 0;
      return next;
    });

  /** apply — the profile wins. The one direction that MODIFIES the model, hence the commit tone. */
  const apply = (types: string[], only?: string) =>
    setDraft((previous) => {
      if (!lane.fixture) {
        say(
          "Use plan current family to review and apply the saved JSON. Save any draft edits first.",
        );
        return previous;
      }
      const next = structuredClone(previous);
      for (const row of rows) {
        if (row.kind !== "profile") continue;
        if (only !== undefined && row.name !== only) continue;
        for (const typeName of types) {
          if (agreementOf(world, previous, row, typeName) !== "drift") continue;
          const entry = next.live[row.name]?.[typeName];
          if (!entry) continue;
          entry.value = effective(next, row.name, typeName);
          entry.drift = false;
        }
      }
      return next;
    });

  const captureAll = (types: string[]) => {
    const count = driftCells.filter((cell) => types.includes(cell.typeName)).length;
    capture(types);
    say(`captured ${count} value${count === 1 ? "" : "s"} out of Revit into the profile`);
  };

  const applyAll = (types: string[]) => {
    if (!lane.fixture) {
      say(
        "Use plan current family to review and apply the saved JSON. Save any draft edits first.",
      );
      return;
    }
    const count = driftCells.filter((cell) => types.includes(cell.typeName)).length;
    apply(types);
    say(`simulated ${count} value${count === 1 ? "" : "s"} in the fixture`);
  };

  const busy = useAtomValue(store.atoms.busy);

  /** The host's own schema verdict on the SAVED file. Only meaningful on the live lane: the fixture
   * has no schema behind it, and a green chip there would be claiming a check nobody ran. */
  const snapshot = useAtomValue(store.atoms.snapshot);
  const validation = lane.document ? (snapshot?.validation ?? null) : null;
  const validationSays = (validation?.issues ?? [])
    .slice(0, 3)
    .map((issue) =>
      typeof issue === "object" && issue != null && "message" in issue
        ? String((issue as { message: unknown }).message)
        : JSON.stringify(issue),
    )
    .join(" · ");

  /**
   * SAVE, on whichever lane.
   *
   * FIXTURE: the disk moves to where the draft is. Every caution square goes out in the same beat,
   * and the saved overlay stops differing anywhere — the visible proof that save wrote what the
   * marks said it would.
   *
   * LIVE: the draft is diffed into staged field patches, staged onto `route:settings`, and the
   * host's own `save` writes them under the version token captured at open. Nothing is folded in
   * here on success: the snapshot comes back over SSE with a new token, the lane re-projects, and
   * the store's version-token guard rebuilds the draft from what actually landed. That is the difference
   * between a surface that shows you the write and one that shows you its own optimism.
   */
  // ── THE HOST CROSSINGS (phase D) ──────────────────────────────────────────────────────────────
  //
  // Two verbs, and they are the only two on this page that talk to Revit. Everything else above is
  // arithmetic on the draft — a page-local move that becomes real when `save profile` writes it.
  //
  //   capture live   READS. `route:family`'s `capture_evidence` wraps `revit.detail.family-model`
  //                  and stamps the result into the evidence slice. It moves nothing into the
  //                  profile; that is `capture all`'s job, under the ⇄ live overlay, once there is
  //                  a reading to move.
  //   build .rfa     WRITES, outside the page and outside the document: `build_evidence` re-opens
  //                  the SAVED family.json host-side and hands it to `revit.apply.family-model`,
  //                  which materializes an .rfa and returns evidence pinned to that revision. It
  //                  is the whole reason the arming ceremony exists — see `#/family/build`.
  //
  // `family.editor.apply` is deliberately NOT wired: the profile-wins direction is a later phase,
  // and the apply verbs above stay page-local and honest about it.

  const capturing = busy?.id === "capture";
  /** null → unarmed. Carries the token the plan was armed against — the plan hash a drift cites. */
  const armedBuild = useAtomValue(store.atoms.armedBuild);
  const building = busy?.id === "build";
  /** A latched unknown outcome. Host failures stay on the core's failure channel. */
  const buildFacts = useAtomValue(store.atoms.buildFacts);
  const buildOutcome = useAtomValue(store.atoms.buildOutcome);

  // ── the geometry verbs ────────────────────────────────────────────────────────────────────────

  /** Retype a frozen literal. It stays frozen — this edits the number, not its reachability. */
  const editLiteral = (slug: string, property: string, value: string): string | void => {
    const trimmed = value.trim();
    // An emptied literal is not a value — the geometry would have no number at all. Refused OUT
    // LOUD: returning the reason makes the editable `StateCell` restore the old literal and wear
    // the caution note (R8), and the receipt says what would have happened.
    if (trimmed === "") {
      const text = `Refused — ${slug}.${property} is a frozen literal, so it cannot be emptied: the geometry would have no dimension at all. Type a number, or bind it to a parameter to give it somewhere else to come from.`;
      say(text);
      return text;
    }
    setDraft((previous) => {
      const next = structuredClone(previous);
      next.geom[slug] = {
        dims: { ...next.geom[slug]?.dims, [property]: trimmed },
        meta: { ...next.geom[slug]?.meta },
      };
      next.dirty = true;
      return next;
    });
  };

  const editMeta = (slug: string, key: string, value: string) =>
    setDraft((previous) => {
      const next = structuredClone(previous);
      next.geom[slug] = {
        dims: { ...next.geom[slug]?.dims },
        meta: { ...next.geom[slug]?.meta, [key]: value },
      };
      next.dirty = true;
      return next;
    });

  /**
   * BIND — a ghost row's one crossing, in the only two shapes it has.
   *
   *   to an existing parameter — the literal is DISCARDED and the dim starts reading that row.
   *     The ghost vanishes and the parameter grows a consumer; nothing else moves.
   *   to a new parameter       — the literal is KEPT and becomes that parameter's family value,
   *     so the geometry is byte-identical afterwards and only its reachability changed. That is
   *     the honest promotion: binding must never quietly move a number.
   */
  const bindTo = (slug: string, property: string, paramName: string) => {
    const literal = bindingOf(world, draft, slug, property);
    setDraft((previous) => {
      const next = structuredClone(previous);
      next.geom[slug] = {
        dims: { ...next.geom[slug]?.dims, [property]: `param:${paramName}` },
        meta: { ...next.geom[slug]?.meta },
      };
      next.dirty = true;
      return next;
    });
    setBinding(null);
    setFocus({ kind: "param", id: paramName });
    say(`bound ${slug}.${property} to ${paramName} — its ${literal} literal is gone`);
  };

  const bindToNew = (slug: string, property: string, dataType: string) => {
    const literal = bindingOf(world, draft, slug, property);
    const base = paramNameFor(slug, property);
    const taken = new Set(Object.keys(draft.authored));
    let name = base;
    for (let n = 2; taken.has(name); n += 1) name = `${base} ${n}`;
    setDraft((previous) => {
      const next = structuredClone(previous);
      next.authored[name] = literal;
      next.newParams = [...next.newParams, { name, dataType, group: "geometry" }];
      next.geom[slug] = {
        dims: { ...next.geom[slug]?.dims, [property]: `param:${name}` },
        meta: { ...next.geom[slug]?.meta },
      };
      next.dirty = true;
      return next;
    });
    setBinding(null);
    setFocus({ kind: "param", id: name });
    setInspect({ kind: "param", name });
    say(`promoted ${slug}.${property} → new parameter "${name}" seeded with ${literal}`);
  };

  // ── grounding highlight — independent of proposals, so it survives acceptance ──────────────────

  // MEMOISED, and that is load-bearing rather than tidy: `columns` depends on nothing that hover
  // touches, but a fresh Set identity on every render would still churn the array, and MasterTable
  // hands each column's `cell` to FlexRender as a COMPONENT TYPE. A new function identity there is
  // a new type, which unmounts and remounts every cell — including the input you are typing in.
  // Stable focus sets keep the table's inputs alive while the pointer moves.
  /**
   * ONE focus, COMPOSED rather than duplicated. Hover wins while the pointer is over something;
   * the inspected subject holds the focus the rest of the time. So opening a constituent's editor
   * lights its shape in the drawing and its parameters in the table and keeps them lit — which is
   * the one-focus law doing the work, not a second highlight channel bolted on beside it.
   */
  const heldFocus = useMemo<Focus>(
    () =>
      inspect == null
        ? null
        : inspect.kind === "part"
          ? { kind: "part", id: inspect.slug }
          : { kind: "param", id: inspect.name },
    [inspect],
  );
  const liveFocus = focus ?? heldFocus;
  const focusedParams = useMemo(
    () => paramsInFocus(world, liveFocus, draft),
    [world, liveFocus, draft],
  );
  const focusedParts = useMemo(() => partsInFocus(liveFocus, consumers), [liveFocus, consumers]);
  const litBlocks = useMemo(() => {
    const set = new Set<string>();
    for (const param of focusedParams) for (const id of world.grounding[param] ?? []) set.add(id);
    if (focusedProposal) {
      const proposal = world.proposals.find((entry) => entry.id === focusedProposal);
      if (proposal) set.add(proposal.sourceBlockId);
    }
    return set;
  }, [world, focusedParams, focusedProposal]);

  // ── columns ───────────────────────────────────────────────────────────────────────────────────
  //
  // Built by shared factories, because the DRILL-IN uses the same MasterTable and must therefore
  // use literally the same cells: the identity column and a type column are the two pieces both
  // modes need, and a per-type view that merely LOOKED like the cross-type table would drift away
  // from it the first time either changed.

  /** The verdict rail: scannable, countable, and carrying no verdict of its own. */
  return {
    store,
    profile,
    stage,
    lane,
    world,
    draft,
    setDraft,
    overlay,
    setOverlay,
    saved,
    tableState,
    setTableState,
    drillState,
    setDrillState,
    docMode,
    setDocMode,
    docZoom,
    setDocZoom,
    drillType,
    setDrillType,
    stageType,
    setStageType,
    focus,
    setFocus,
    focusedProposal,
    setFocusedProposal,
    pinnedParam,
    setPinnedParam,
    anatomyCollapsed,
    setAnatomyCollapsed,
    target,
    inspect,
    setInspect,
    binding,
    setBinding,
    cardRefs,
    say,
    proposalState,
    proposalsAt,
    proposalsOn,
    openProposals,
    locate,
    rows,
    consumers,
    ghostCount,
    driftCells,
    unsavedCount,
    accept,
    deny,
    reopen,
    sever,
    editAuthored,
    editOverride,
    capture,
    apply,
    captureAll,
    applyAll,
    busy,
    snapshot,
    validation,
    validationSays,
    capturing,
    armedBuild,
    building,
    buildFacts,
    buildOutcome,
    editLiteral,
    editMeta,
    bindTo,
    bindToNew,
    heldFocus,
    liveFocus,
    focusedParams,
    focusedParts,
    litBlocks,
  };
}

export type FamilyWorkspaceCore = ReturnType<typeof useFamilyWorkspaceCore>;
