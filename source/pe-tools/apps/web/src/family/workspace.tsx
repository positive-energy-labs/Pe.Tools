/**
 * /family — THE surface for ONE family.
 *
 * Promoted 2026-08-16 out of the clean room: this was `?variant=e`, the converged survivor of a
 * five-way rebuild, and the ruling was that it IS the product. It is now the route. The four
 * rivals live on snapshot branch `proto/family-variants-2026-08`; the surface it replaced — the
 * authored/live two-lane workspace — is in git at `0af4260`.
 *
 *   THE TABLE IS THE INTERFACE. One row per parameter, one column per TYPE, and the cross-type
 *   spread is never hidden — the whole point of a family is that its types disagree on purpose,
 *   and the only way to audit that is to see them side by side. Spreadsheet discipline: a cell is
 *   either editable or properly disabled WITH a reason. Nothing is greyed out mysteriously.
 *
 *   A-MODE DRILL-IN. Clicking a type's column header swaps the table pane — not the page — into
 *   an aligned profile | spine | live reconciler for that one type. Esc comes back.
 *
 *   THE DOC PANE IS A SIDEBAR ON THE TABLE, like takeoff's. One pane, two modes: the OCR'd text
 *   blocks, or a stand-in for the real page camera. Proposals dock on top of it as annotation
 *   cards. Hovering a grounded row lights its citation in whichever mode is showing; the citation
 *   comes from WORLD.grounding, so it survives its proposal being accepted.
 *
 *   THE ANATOMY IS A COLLAPSIBLE VISUAL PANE over the table, drawn from the profile's own
 *   parameter values. Hovering a solid lights the parameters it consumes and vice versa — one
 *   focus, two views, never two independent highlights.
 *
 *   RAIL = SCANNABLE. A narrow gutter left of every row. Blank when nothing is proposed; one dot
 *   in pea's ink when one proposal lands on the row; a counted chip when several do. It answers
 *   exactly one question, top to bottom, without reading a single value: WHERE do proposals live.
 *
 *   CELLS = LOCATABLE. Each proposed cell wears a small corner fold in pea's ink. The rail says
 *   the row is contested; the folds say WHICH cells in it are. Neither covers a value, neither
 *   changes the table's geometry, and neither carries a verdict.
 *
 *   CARDS = DECIDABLE. Accept and deny live only on the sidebar cards, next to the spec text that
 *   justifies them. Clicking a rail dot or a corner fold focuses the card(s); nothing pops over
 *   the table, so the evidence and the decision are never hidden by the affordance that reached
 *   them.
 *
 *   TYPING BEATS PROPOSING. A proposed cell is an ordinary editable cell. The moment you commit
 *   your own value into it the proposal linkage is SEVERED — no accept, no deny, the card settles
 *   to "superseded by your edit". Grounding is untouched: a citation is a fact about where a
 *   number came from, not a fact about pea.
 *
 * THE GHOST-ROW LAW, in the user's words:
 *
 *   "Everything on a geom property that is bindable to a param should be visible in the table as
 *    a ghost row, but still editable. If it's unbound in the profile it's sorted to bottom. If it
 *    is bound, it's represented by that param. Non-bindable properties live somewhere else."
 *
 * Which resolves the one thing the table could not previously say. A family's numbers do not all
 * live in its parameters: a dimension frozen into the geometry is a number no type can differ on,
 * no schedule can read, and no formula can reach — and until now the surface showed it NOWHERE, so
 * the difference between "the bore is 3in because a parameter says so" and "the bore is 3in
 * forever" was invisible. The law puts both in the same table and distinguishes them by SHAPE:
 * bound dims are already there, wearing their parameter's row; unbound ones fall to the bottom as
 * ghosts. The bottom of the table becomes the list of numbers nothing can reach, and each ghost
 * carries exactly one verb — bind — which is its one crossing out of that condition.
 *
 * NON-BINDABLE metadata (a connector's direction, its system type, a normal) lives in the doc
 * pane's lower half instead, which is also where a PARAMETER's family-level value lives.
 *
 * THE CELL-STATE LAW, in the user's words:
 *
 *   "For each param value there are three dimensions, in order of importance: parameter name,
 *    family type, and proposed/grounded/live/saved (pseudo-dimension). These states are cell
 *    states or togglable overlays on the value cells."
 *
 * Which kills the LIVE COLUMN. A column is the second dimension — a family type — and Revit was
 * never a fourth type; it was a fourth reading of the same three. Now those readings go exactly
 * where they belong — INTO the three cells they are readings of — under an overlay you switch.
 * The grid is parameter × type and nothing else, forever.
 *
 *   THE OVERLAY IS THE PSEUDO-DIMENSION. `draft` shows the page-state values, editable. `⇄ live`
 *   swaps every value cell to what Revit carries, read-only, alarm where it differs. `⇄ saved`
 *   swaps them to what is on disk, read-only, caution where it differs. Nothing moves: the row
 *   set, the column set, and every row height are identical in all three.
 *
 *   THE MARKS SURVIVE THE OVERLAY. A proposal's fold and a grounded cell's hairline underline are
 *   facts about the CELL, not about which reading is showing, so they persist across all three.
 *
 *   THE LIVE OVERLAY IS THE RECONCILE ROOM. capture-all and apply-all are dark in `draft` and lit
 *   under `⇄ live`, because a bulk crossing you cannot see the far side of is a bulk crossing made
 *   blind (SURFACE-PHILOSOPHY §2). Per-cell capture/apply stay in the drill-in.
 *
 * ── WHAT IS AND IS NOT WIRED (phase B, 2026-08-17) ──────────────────────────────────────────
 * TWO LANES, ONE SHAPE. `useFamilyLane` answers the only question that separates them — is a
 * family document open in `route:settings`? — and the page below it renders ONE `PageWorld` either
 * way. Nothing in this file asks whether a host exists.
 *
 *   LIVE     — a real `family.json`, parsed and projected. The document slot lists what the bound
 *              session can see and picking one runs settings `open`; `save profile` diffs the
 *              draft into staged field patches and runs settings `save`, whose refusal (a version
 *              conflict, a schema failure, a field still flagged for attention) is surfaced
 *              VERBATIM on the same receipt channel every other verb uses.
 *   FIXTURE  — no document. `FIXTURE_WORLD`, wearing the dashed seam chip, save page-local. Not a
 *              fallback: a DECLARED lane, and the chip says what replaces it.
 *
 * ── THE TWO HOST CROSSINGS (phase D, 2026-08-17) ────────────────────────────────────────────
 * The table pane header's last two verbs are the only two on this page that talk to Revit, and they
 * are the two directions evidence travels:
 *
 *   capture live   `route:family` `capture_evidence` → `revit.detail.family-model`. A READ. Its
 *                  result lands in the evidence slice, the projection turns it into the live half,
 *                  and the ⇄ live overlay, the drift marks and the freshness chip are all readings
 *                  OF it. Refuses in the host's own words when no family document is active in
 *                  Revit. It moves nothing into the profile — `capture all` does that, under the
 *                  overlay, once there is a reading to move.
 *   build .rfa     `route:family` `build_evidence` → `revit.apply.family-model`. A WRITE, and the
 *                  only one that leaves both the page and the document: it re-opens the SAVED
 *                  family.json host-side and materializes a timestamped .rfa. Because it reads the
 *                  file rather than the table, it is armed rather than pressed — the ceremony, its
 *                  refusal predicates and its receipt live in `#/family/build`.
 *
 * STILL PAGE-LOCAL ON BOTH LANES, and honest about it: `apply` in both its bulk and per-type shapes
 * (`family.editor.apply` is a later phase — the profile-wins direction has no concurrency guard yet),
 * and the proposals with their accept/deny (they need `route:settings` field
 * proposals, which the projection deliberately does not invent), and the doc pane's parse.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import {
  ReadCell,
  StateDot,
  TextCell,
  VERDICT_INK,
  VerdictCell,
} from "#/components/master-table/cells";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column, MasterTableState, Verdict } from "#/components/master-table/model";
import { Sentence } from "#/components/sentence";
import { Pane, PaneWorkspace } from "#/components/ui/pane";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { Switcher } from "#/components/lang/switcher";
import { AnatomyDrawing } from "#/family/anatomy";
import {
  BUILD_OUTCOME_UNKNOWN,
  BUILD_VERB,
  BuildStrip,
  buildOutputPath,
  buildReceiptLine,
  buildRefusals,
  readBuildReceipt,
  type BuildFacts,
  type BuildRefusal,
} from "#/family/build";
import { ProposalCard, SpecSheet, SpecText } from "#/family/doc-pane";
import { NavStateCell, ProposedCell } from "#/family/marks";
import { FAMILY_MODULE } from "#/family/host";
import { useFamilyLane } from "#/family/lane";
import {
  AGREEMENT_TONE,
  MARK,
  MARK_TITLE,
  OVERLAY_LABEL,
  OVERLAY_TITLE,
  agreementOf,
  bindingOf,
  consumersOf,
  draftValueAt,
  effective,
  ghostRows,
  initialDraft,
  isFormula,
  isUnsavedAt,
  paramNameFor,
  paramsInFocus,
  partsInFocus,
  pinnedSort,
  rowAgreement,
  savedFrom,
  savedValueAt,
  sortDirOf,
  type CellVerdict,
  type Draft,
  type Focus,
  type Overlay,
  type PRow,
  type PageWorld,
  type SavedProfile,
} from "#/family/model";
import { draftToPatches } from "#/family/project";
import {
  boundParam,
  type GeomMeta,
  type GeomConstituent,
  type ProtoProposal,
} from "#/family/world";
import { cn } from "#/lib/utils";

type DocMode = "text" | "sheet";

export function FamilyWorkspace({ requestedFamily }: { requestedFamily?: string }) {
  /** WHICH LANE — the one question that separates them, asked once (see `#/family/lane`). */
  const lane = useFamilyLane();
  const { world, store } = lane;
  /**
   * The last-read document, as a draft. It is the page's record of the DISK and the baseline the
   * reverse projection diffs against — so a save writes what moved and nothing else, and a draft
   * back at its baseline honestly has nothing to save.
   */
  const savedDraft = useMemo(() => initialDraft(world), [world]);

  const [draft, setDraft] = useState<Draft>(() => initialDraft(world));
  /** THE PSEUDO-DIMENSION. PAGE state, never the URL: which reading you are looking through is not
   * a place, and a link that restored someone else's overlay would be claiming it is. Draft is the
   * default because it is the only one you can work in. */
  const [overlay, setOverlay] = useState<Overlay>("draft");
  /** The disk, per cell. Seeded from the document — it starts saved — and re-snapshotted on save. */
  const [saved, setSaved] = useState<SavedProfile>(() => savedFrom(initialDraft(world)));
  /** Table state is OWNED here, because the sort direction is an input to the ghost-pinning
   * workaround — the sort key has to know which way it is about to be read. */
  const [tableState, setTableState] = useState<MasterTableState>(() => ({
    filters: {},
    sorts: [],
    query: "",
  }));
  const [drillState, setDrillState] = useState<MasterTableState>(() => ({
    filters: {},
    sorts: [],
    query: "",
  }));
  const [docMode, setDocMode] = useState<DocMode>("text");
  const [docZoom, setDocZoom] = useState(1);
  const [drillType, setDrillType] = useState<string | null>(null);
  const [stageType, setStageType] = useState<string>(
    world.typeNames[1] ?? world.typeNames[0] ?? "Standard",
  );
  const [focus, setFocus] = useState<Focus>(null);
  const [focusedProposal, setFocusedProposal] = useState<string | null>(null);
  /** The row whose proposals were last LOCATED from the table. Sticky — hover comes and goes, but
   * "I clicked this row's rail dot" has to survive the pointer leaving the row on its way to the
   * sidebar, or the cards would go dark exactly as you reached for them. */
  const [pinnedParam, setPinnedParam] = useState<string | null>(null);
  const [anatomyCollapsed, setAnatomyCollapsed] = useState(false);
  const [receipt, setReceipt] = useState<{ text: string; atMs: number } | null>(null);
  const [target, setTarget] = useState("");
  /**
   * What the doc pane's LOWER HALF is showing. One slot, two subjects: a constituent's
   * non-bindable metadata, or a parameter's family-level value. They share the slot because they
   * are the same question asked twice — "what is true of this thing itself, rather than of it at
   * some type" — and because a page with two inspectors has no answer to which one you meant.
   */
  const [inspect, setInspect] = useState<
    { kind: "part"; slug: string } | { kind: "param"; name: string } | null
  >(null);
  /** The ghost row whose bind picker is open. One at a time; picking or cancelling closes it. */
  const [binding, setBinding] = useState<{ slug: string; property: string } | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const say = (text: string) => setReceipt({ text, atMs: Date.now() });

  /**
   * RE-SEED ON A NEW REVISION, and only then.
   *
   * `lane.seedKey` is "which document, at which version token". It changes when you pick a
   * different document and when a save bumps the token — both of which mean the draft you were
   * holding describes something that is no longer in front of you. It does NOT change on an
   * unrelated re-render, which is what keeps work in progress alive.
   *
   * The ref rather than the effect's dependency list is load-bearing: React may run an effect twice
   * for the same value, and a re-seed that fired twice would throw away the edit you made between.
   */
  const seededRef = useRef(lane.seedKey);
  useEffect(() => {
    if (seededRef.current === lane.seedKey) return;
    seededRef.current = lane.seedKey;
    const next = initialDraft(world);
    setDraft(next);
    setSaved(savedFrom(next));
    setStageType(world.typeNames[1] ?? world.typeNames[0] ?? "");
    // Modes that named something in the OLD document cannot survive it.
    setDrillType(null);
    setInspect(null);
    setBinding(null);
    setFocus(null);
    setFocusedProposal(null);
    setPinnedParam(null);
    setOverlay("draft");
  }, [lane.seedKey, world]);

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

  const verdictOf = (id: string): CellVerdict => draft.verdicts[id] ?? "open";

  /** Every OPEN proposal aimed at exactly one cell: a type override, or the family-level value.
   * A list, not a single one — a cell may be argued about twice, and hiding the second would be
   * the surface lying about how much is outstanding. */
  const proposalsAt = (param: string, typeName: string | null): ProtoProposal[] =>
    world.proposals.filter(
      (entry) =>
        entry.param === param &&
        (entry.typeName ?? null) === typeName &&
        verdictOf(entry.id) === "open",
    );

  /** Every open proposal anywhere on a parameter's row — what the RAIL counts. */
  const proposalsOn = (param: string): ProtoProposal[] =>
    world.proposals.filter((entry) => entry.param === param && verdictOf(entry.id) === "open");

  const openProposals = world.proposals.filter((entry) => verdictOf(entry.id) === "open");

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
      next.verdicts[proposal.id] = "accepted";
      next.dirty = true;
      return next;
    });
    say(`accepted ${proposal.param} = ${proposal.proposed}`);
  };

  const deny = (proposal: ProtoProposal) => {
    setDraft((previous) => ({
      ...previous,
      verdicts: { ...previous.verdicts, [proposal.id]: "denied" },
    }));
    say(`denied a proposal — the profile is unchanged`);
  };

  /**
   * TYPING BEATS PROPOSING. Committing your own value into a cell severs every open proposal
   * aimed at that exact cell — including an empty commit, which hands the type back to inheriting
   * and is just as much a decision. There is no verdict left to give: pea argued for a number and
   * you wrote a different one, so accept and deny both became meaningless. The card settles muted,
   * never on `--r-done` — nothing of pea's was adopted.
   */
  const sever = (next: Draft, param: string, typeName: string | null) => {
    for (const entry of world.proposals) {
      if (entry.param !== param) continue;
      if ((entry.typeName ?? null) !== typeName) continue;
      if ((next.verdicts[entry.id] ?? "open") !== "open") continue;
      next.verdicts[entry.id] = "superseded";
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
    const count = driftCells.filter((cell) => types.includes(cell.typeName)).length;
    apply(types);
    say(`applied ${count} value${count === 1 ? "" : "s"} into the live family`);
  };

  const [saving, setSaving] = useState(false);

  /**
   * OPEN — the lane switch, and the only verb on this page that changes which file the page IS.
   * It runs the settings lifecycle's `open`, which preserves the field trichotomy: proposals pea
   * already made against a document survive you looking at another one and coming back.
   */
  const openDocument = (relativePath: string) =>
    void (async () => {
      const opened = await store.settingsCommand("open", {
        documentId: { ...FAMILY_MODULE, relativePath },
      });
      if (!opened.ok)
        say(
          `Could not open ${relativePath} — ${opened.hint ?? opened.error ?? "the host refused, without saying why"}`,
        );
    })();

  /** The host's own schema verdict on the SAVED file. Only meaningful on the live lane: the fixture
   * has no schema behind it, and a green chip there would be claiming a check nobody ran. */
  const validation = lane.document ? (store.snapshot?.validation ?? null) : null;
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
   * the re-seed effect above rebuilds the draft from what actually landed. That is the difference
   * between a surface that shows you the write and one that shows you its own optimism.
   */
  const save = async () => {
    if (!lane.document) {
      setSaved(savedFrom(draft));
      setDraft((previous) => ({ ...previous, dirty: false }));
      say(`saved ${world.path} — ${unsavedCount} value${unsavedCount === 1 ? "" : "s"} written`);
      return;
    }
    const patches = draftToPatches(lane.document.model, draft, savedDraft);
    if (patches.length === 0) {
      say(
        `Nothing to write — every value in the draft already matches ${lane.document.relativePath} on disk.`,
      );
      return;
    }
    setSaving(true);
    try {
      // The host refuses in its own words, and those words are the teaching channel — a conflict, a
      // schema failure and a field flagged for attention are three different refusals, and
      // flattening them into "save failed" would be the surface throwing away the only help there is.
      const staged = await store.applyFields(patches);
      if (!staged.ok) {
        say(`Refused while staging — ${staged.hint ?? staged.error ?? "the document rejected it"}`);
        return;
      }
      const written = await store.settingsCommand("save");
      if (!written.ok) {
        say(`Refused — ${written.hint ?? written.error ?? "save failed"}`);
        return;
      }
      say(
        `saved ${lane.document.relativePath} — ${patches.length} field${patches.length === 1 ? "" : "s"} written`,
      );
    } finally {
      setSaving(false);
    }
  };

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

  const [capturing, setCapturing] = useState(false);
  /** null → unarmed. Carries the token the plan was armed against — the plan hash a drift cites. */
  const [armedBuild, setArmedBuild] = useState<{ token: string | null; reason: string } | null>(
    null,
  );
  const [building, setBuilding] = useState(false);
  /** The host's own last word on a build, or a latched unknown outcome. Outranks the predicates. */
  const [buildSaid, setBuildSaid] = useState<BuildRefusal | null>(null);

  /** Fields staged onto `route:settings` but not yet written — unsaved by another route. */
  const stagedCount = useMemo(
    () => Object.values(store.fields).filter((field) => field.staged != null).length,
    [store.fields],
  );

  /** Everything the ceremony reads, in one flat record. The predicates live in `#/family/build`. */
  const buildFacts = useMemo<BuildFacts>(
    () => ({
      relativePath: lane.document?.relativePath ?? null,
      versionToken: lane.document?.versionToken ?? null,
      validation,
      unsavedCount,
      stagedCount,
      boundTarget: store.boundTarget,
      armedToken: armedBuild?.token ?? null,
    }),
    [lane.document, validation, unsavedCount, stagedCount, store.boundTarget, armedBuild],
  );

  /**
   * A FRESH READ IS NOT A NEW DOCUMENT. Evidence arriving — from either crossing — has to reach the
   * LIVE half of the draft, and must not touch the authored half: `lane.seedKey` deliberately does
   * not move for a capture, because re-seeding would throw away edits in progress. A live value is
   * a READING of Revit, not part of what you are editing, so it is folded in on its own.
   */
  const evidenceStamp = store.evidence?.from.capturedAt ?? null;
  const liveValues = world.live?.values ?? null;
  const evidenceRef = useRef(evidenceStamp);
  useEffect(() => {
    if (evidenceRef.current === evidenceStamp) return;
    evidenceRef.current = evidenceStamp;
    setDraft((previous) => ({ ...previous, live: structuredClone(liveValues ?? {}) }));
  }, [evidenceStamp, liveValues]);

  const captureLive = async () => {
    setCapturing(true);
    try {
      const read = await store.familyCommand("capture_evidence", {});
      if (!read.ok) {
        // The host's words verbatim — "is a family document active in the bound session?" IS the
        // exit, and paraphrasing it into "capture failed" would throw away the only help there is.
        say(
          `Could not read the live family — ${read.hint ?? read.error ?? "the host refused, without saying why"}`,
        );
        return;
      }
      const payload = (read.result ?? {}) as { familyName?: string; parameterCount?: number };
      say(
        `read ${payload.familyName ?? "the live family"} out of Revit — ${payload.parameterCount ?? 0} parameters; the ⇄ live overlay is now stamped with this read`,
      );
    } finally {
      setCapturing(false);
    }
  };

  /**
   * THE COMMIT. Fires only from the armed strip, and only once its own predicates are silent — but
   * it re-checks them here anyway, because the strip's arming is page state and this is the write.
   */
  const runBuild = async () => {
    const relativePath = lane.document?.relativePath;
    if (relativePath == null || armedBuild == null) return;
    if (buildRefusals({ ...buildFacts, armedToken: armedBuild.token }).length > 0) return;
    setBuilding(true);
    setBuildSaid(null);
    try {
      const built = await store.familyCommand("build_evidence", {
        documentId: { ...FAMILY_MODULE, relativePath },
      });
      if (!built.ok) {
        const says = built.hint ?? built.error ?? "the host refused, without saying why";
        setBuildSaid({ code: "host", says });
        say(`Build refused — ${says}`);
        return;
      }
      const receipt = readBuildReceipt(built.result);
      if (receipt == null) {
        // OUTCOME UNKNOWN, latched. `build_evidence` mutates outside the page — it writes a file —
        // so an answer with no receipt is neither a success nor a refusal, and claiming either
        // would be the surface inventing a fact about the disk.
        setBuildSaid({ code: "unknown", says: BUILD_OUTCOME_UNKNOWN });
        say(BUILD_OUTCOME_UNKNOWN);
        return;
      }
      // Disarm on the way out: the plan was spent, and a strip still armed against a token the
      // build has already consumed would invite a second, differently-named .rfa.
      setArmedBuild(null);
      say(buildReceiptLine(receipt, new Date().toLocaleTimeString()));
    } finally {
      setBuilding(false);
    }
  };

  /** Re-arm against the file as it now stands. Writes nothing — the one exit every refusal shares. */
  const replanBuild = () => {
    setBuildSaid(null);
    setArmedBuild({ token: lane.document?.versionToken ?? null, reason: "" });
  };

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
  const railColumn = (): Column<PRow> => ({
    key: "rail",
    label: "",
    group: "PARAMETER",
    width: "w-6",
    title:
      "The verdict rail — the page's answer to 'where do proposals live', readable top to bottom without reading a single value. A dot means one proposal on this row; a counted chip means several. Clicking either LOCATES them in the sidebar; it never decides anything, because a verdict belongs next to the spec text that justifies it.",
    cell: (row) => {
      const open = proposalsOn(row.name);
      const accepted = world.proposals.filter(
        (entry) => entry.param === row.name && verdictOf(entry.id) === "accepted",
      );
      if (open.length === 0)
        return accepted.length > 0 ? (
          <ReadCell
            className="text-center text-done"
            value="✓"
            reason="Every proposal on this row is settled, and at least one was accepted — the value is in the profile, and its citation is still live in the sidebar."
          />
        ) : null;

      const where = open
        .map(
          (entry) =>
            `${entry.typeName ?? "family value"}: ${entry.current ?? "—"} → ${entry.proposed}`,
        )
        .join(" · ");
      return (
        <span className="flex h-7 items-center justify-center">
          <button
            type="button"
            onClick={() => locate(open[0]!)}
            aria-label={`locate ${open.length} proposal(s) on ${row.name}`}
            title={
              open.length === 1
                ? `One open proposal on ${row.name} — ${where}. Click to bring its card into view in the doc sidebar, where accept and deny sit beside the spec text. Nothing pops over the table.`
                : `${open.length} open proposals on ${row.name}, at different types — ${where}. The row is contested more than once; the corner folds in the cells say WHICH cells. Click to bring the cards into view.`
            }
            /* Pea's identity, never the commit colour: a MARK takes `--r-pea` (the display rung),
               a counted chip is text and takes pea's ink. */
            className={cn(
              "face-mono flex items-center justify-center",
              open.length === 1
                ? "size-2 rounded-[1px] bg-pea"
                : "h-3.5 min-w-3.5 rounded-[2px] border border-pea px-0.5 t-caption leading-none text-pea-ink",
            )}
          >
            {open.length > 1 ? open.length : null}
          </button>
        </span>
      );
    },
  });

  /**
   * The parameter's identity — and, since the family-value COLUMN is gone, the only place the
   * family level shows itself: a formula renders as a second line here, and a family-level
   * proposal wears its fold here. That is honest about where the value lives, where a fourth
   * value column pretending to be a fourth type was not.
   */
  const identityColumn = (state: MasterTableState): Column<PRow> => ({
    key: "param",
    label: "parameter",
    group: "PARAMETER",
    width: "w-64",
    // Sorting NEVER lifts a ghost above a parameter — the rank rides in front of the name. See
    // pinnedSort: this is an emulation of a row-pinning primitive MasterTable does not have.
    sort: (row) => pinnedSort(row, row.name, sortDirOf(state, "param")),
    search: (row) => `${row.name} ${row.dataType} ${row.group}`,
    title:
      "One row per parameter — the unit of the whole page. The marks after the name are the tight facts: instance binding, whether Revit has it at all, and which spec block grounds it. The second line carries the family level: a formula, and the geometry properties this parameter DRIVES. Click the name to open it in the inspector, where its family value is edited.",
    cell: (row) => {
      // GHOST — not a parameter, and it must never be mistakable for one. Muted, italic, named in
      // the geometry's vocabulary (slug.property, not Title Case). Its literal lives OUT of this
      // cell, in a single merged cell across the type columns, which is the honest shape of "one
      // number, no per-type spread".
      if (row.kind === "ghost") {
        const slug = row.slug ?? "";
        const property = row.property ?? "";
        const literal = bindingOf(world, draft, slug, property);
        const dim = world.geomBySlug.get(slug)?.dims.find((entry) => entry.property === property);
        return (
          <span className="flex h-7 min-w-0 items-center px-1.5">
            <button
              type="button"
              onClick={() => setInspect({ kind: "part", slug })}
              title={`${slug}.${property} — a bindable ${row.dataType} dimension that NO parameter drives. ${dim?.note ?? ""} It is ${literal} for every type of this family, forever: no type can differ, no schedule can read it, no formula can reach it. Its value is the ONE merged cell to the right, spanning every type column, because there is exactly one of it. Click to open ${slug} in the inspector; use "bind…" in the state column to give it a parameter.`}
              className="face-mono block w-full truncate text-left t-caption italic leading-[12px] text-ink-mute hover:text-ink"
            >
              {row.name}
              <span className="ml-1 not-italic t-caption text-caution">geom</span>
            </button>
          </span>
        );
      }

      const authored = draft.authored[row.name] ?? "";
      const blocks = world.grounding[row.name] ?? [];
      const family = proposalsAt(row.name, null);
      const drives = consumers.get(row.name) ?? [];
      const reason = `${row.name} — ${row.dataType}, bound per ${
        row.isInstance
          ? "instance (a placed element may depart from it; the family still authors a default per type, which is what the type columns hold)"
          : "type"
      }.${isFormula(authored) ? ` Driven by the family-level formula ${authored}, so no type can override its result.` : ""}${
        world.missingInRevit.has(row.name)
          ? " ⊘ — the live family has no parameter by this name; apply moves values, not schema."
          : ""
      }${
        blocks.length > 0
          ? ` Grounded in ${blocks.join(", ")} of ${world.spec?.fileName ?? "the spec"} — hover the row to light it in the sidebar.`
          : " Ungrounded: nothing in the spec claims this number."
      }${family.length > 0 ? ` Pea proposes a FAMILY-LEVEL value here: ${family[0]!.current ?? "—"} → ${family[0]!.proposed}. Accepting it moves every type that does not override.` : ""}${
        drives.length > 0
          ? ` Drives ${drives.map((entry) => `${entry.slug}.${entry.property}`).join(", ")} — this row IS those dimensions, which is why they have no rows of their own.`
          : row.kind === "profile"
            ? " Drives no geometry the profile declares — it is schedule data, or it is dead."
            : ""
      }`;
      return (
        <ProposedCell
          proposals={family}
          onLocate={locate}
          where={`the family value of ${row.name}`}
        >
          <span className="face-mono t-value block min-w-0 flex-1 truncate px-1.5" title={reason}>
            <span className="block truncate leading-[13px]">
              {row.kind === "live-only" ? (
                <span className="text-ink-2">{row.name}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setInspect({ kind: "param", name: row.name })}
                  title={`Open ${row.name} in the inspector below the spec — where its FAMILY-LEVEL value is edited, along with its formula, its consumers, and its citation. The type columns on this row only ever hold overrides; the value they inherit lives there.`}
                  className="hover:underline"
                >
                  {row.name}
                </button>
              )}
              {row.isInstance && <span className="ml-1 t-caption text-ink-mute">inst</span>}
              {world.missingInRevit.has(row.name) && (
                <span className="ml-1 t-caption text-caution">⊘</span>
              )}
              {blocks.length > 0 && (
                <span className="ml-1 t-caption text-ink-mute">{blocks.join(" ")}</span>
              )}
            </span>
            {/* The family level, on ONE line: the formula, and what the parameter DRIVES. A bound
                geometry dim has no row of its own — it is represented by this parameter — so this
                mark is the only place the representation is visible. Several consumers join here,
                and that join is the point: editing this row moves all of them at once.

                DERIVED SPENDS NO COLOUR: the language has no role for "a formula
                computed this", and the leading `=` already says it. Italic carries the rest. */}
            {(isFormula(authored) || drives.length > 0) && (
              <span className="block truncate t-caption leading-[11px]">
                {isFormula(authored) && <span className="italic text-ink-2">{authored}</span>}
                {isFormula(authored) && drives.length > 0 && (
                  <span className="text-ink-mute"> · </span>
                )}
                {drives.length > 0 && <span className="text-ink-mute">→ </span>}
                {drives.map((entry, index) => (
                  <button
                    key={`${entry.slug}.${entry.property}`}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setInspect({ kind: "part", slug: entry.slug })}
                    title={`${row.name} drives ${entry.slug}.${entry.property}. Click to open ${entry.slug} in the inspector — its non-bindable metadata (direction, system type, where its frame sits) lives there, because no parameter can drive those.`}
                    className="text-ink-mute hover:text-ink"
                  >
                    {index > 0 && <span className="text-ink-mute">, </span>}
                    {entry.slug}.{entry.property}
                  </button>
                ))}
              </span>
            )}
          </span>
        </ProposedCell>
      );
    },
  });

  /** One type's overrides. Identical in the cross-type table and in the drill-in — except
   * alignment: the drill-in right-aligns this column so the profile's number and Revit's meet
   * at the spine and the eye reads one diff, not two lists. */
  const typeColumn = (
    typeName: string,
    options: { header?: boolean; align?: "right" } = {},
  ): Column<PRow> => ({
    key: `type:${typeName}`,
    label: typeName,
    group: "PROFILE",
    width: "w-28",
    right: options.align === "right",
    /* The column on stage is lit by a FILL, never a hue — `--r-select` is literally the ground
       ladder's selection rung, so the law cannot be broken here by accident. */
    headerClassName: options.header && stageType === typeName ? "bg-select" : undefined,
    header: options.header ? (
      <button
        type="button"
        onClick={() => {
          setStageType(typeName);
          setDrillType(typeName);
          // The drill-in has its OWN live column and its own per-row crossings, so it is already a
          // two-substrate view. Carrying the overlay in would put Revit's number in two places at
          // once and make the type column read-only for no reason the drill-in explains.
          setOverlay("draft");
        }}
        title={`Drill into "${typeName}". The table pane swaps to the same table, narrowed to this one type and opened up with the spine and the crossing verbs. "← all types" in the pane header, or Esc, comes back.`}
        className="face-mono t-label block w-full text-left text-ink-2 hover:text-ink"
      >
        {typeName} <span className="opacity-60">⤢</span>
      </button>
    ) : undefined,
    title: `What "${typeName}" overrides in the DRAFT. An empty cell INHERITS — the family value shows through as the grey placeholder, which is the only place the family level appears now that it has no column of its own. Typing creates the override; clearing hands the type back to the family. Under the ⇄ live and ⇄ saved overlays this same column shows Revit's number and the disk's number instead, read-only, in place.`,
    cell: (row) => {
      // ── the ghost's ONE merged cell ─────────────────────────────────────────────────────────
      // A frozen literal has no per-type spread, so it gets no per-type cells: it gets one cell
      // the width of all of them, left-aligned like every other value. MasterTable cannot express
      // a colspan, so the anchor column renders it and its neighbours are SUPPRESSED — blank, but
      // blank WITH a reason, which is the same discipline every other refusal on this page keeps.
      if (row.kind === "ghost") {
        const slug = row.slug ?? "";
        const property = row.property ?? "";
        if (typeName !== world.mergeAnchor)
          return (
            <ReadCell
              value=""
              reason={`Suppressed — part of the ONE merged value cell for ${row.name}, which begins in the first type column and spans all of them. There is exactly one literal for the whole family, so it is drawn once. (MasterTable has no spanning cell; this is the honest emulation of one.)`}
            />
          );
        const literal = bindingOf(world, draft, slug, property);
        const diskLiteral = saved.geom[slug]?.[property] ?? null;
        if (overlay === "live")
          return (
            <ReadCell
              className="leading-7 text-ink-mute"
              value="unread — not a parameter"
              reason={`UNREAD, not absent. Revit's family certainly carries this number — it is in the solid — but a parameter read cannot report it, because it is not a parameter. Nothing here can be compared, and silence is not agreement. Binding it is what makes it readable at all.`}
            />
          );
        if (overlay === "saved")
          return (
            <ReadCell
              className={cn(
                "leading-7",
                diskLiteral === null
                  ? "italic text-caution"
                  : diskLiteral !== literal
                    ? "text-caution"
                    : "text-ink-2",
              )}
              value={
                diskLiteral === null ? (
                  "not on disk"
                ) : (
                  <>
                    {diskLiteral}
                    {diskLiteral !== literal && <span className="ml-1 text-caution">→</span>}
                  </>
                )
              }
              reason={
                diskLiteral === null
                  ? `${row.name} is not in the saved profile at all.`
                  : diskLiteral === literal
                    ? `The file already carries ${diskLiteral} for ${row.name}. Saving would write nothing here.`
                    : `The file carries ${diskLiteral}; saving writes ${literal} over it.`
              }
            />
          );
        // THE EDITABLE CELL (R8, families #6 discharged here): the grammar draws the caution
        // square + bold for the unsaved staged value and carries the refusal itself — returning
        // the reason from `editLiteral` restores the literal and shows the dismissible note,
        // without the row growing a pixel. The route-drawn RefusalNote this replaced is deleted.
        return (
          <NavStateCell
            value={literal}
            stage={isUnsavedAt(world, draft, saved, row, typeName) ? "staged" : "clean"}
            stagedBy="you"
            note={`The literal itself, as ONE cell across every type — EDITABLE. Typing here rewrites the number frozen into the geometry; it does not make it reachable. That is what binding is for. Emptying it is refused out loud — a dimension with no number is not a state.${
              isUnsavedAt(world, draft, saved, row, typeName)
                ? ` UNSAVED — the file ${diskLiteral === null ? "does not carry this dimension at all" : `carries ${diskLiteral}`}; saving writes ${literal}.`
                : ""
            }`}
            onCommit={(next) => editLiteral(slug, property, next)}
          />
        );
      }

      // ── live-only rows: they exist ONLY under the live overlay, so they only speak there ─────
      if (row.kind === "live-only") {
        const entry = draft.live[row.name]?.[typeName];
        return (
          <ReadCell
            className="leading-7 text-ink-mute"
            value={entry?.value ?? "—"}
            reason={`${MARK_TITLE["only-live"]} The last read listed "${row.name}" as present in the family but reported no per-type value for it, so there is nothing here to compare — only the fact that the parameter exists and the profile does not claim it.`}
          />
        );
      }

      const authored = draft.authored[row.name] ?? "";
      const proposals = proposalsAt(row.name, typeName);
      const grounded = (world.grounding[row.name] ?? []).length > 0;
      const drifted = agreementOf(world, draft, row, typeName) === "drift";
      const diskValue = savedValueAt(saved, row, typeName);
      const draftValue = draftValueAt(world, draft, row, typeName);
      const unsaved = isUnsavedAt(world, draft, saved, row, typeName);
      // The two marks that are facts about the CELL rather than about the reading, so they are
      // applied identically in all three overlays. ONE DECORATION SLOT, RANKED — the language's
      // squiggle law: drift outranks the citation, because a cell that is both is more urgently
      // the first. The citation spends no meaning colour; it is a hairline.
      const underline = drifted
        ? "underline decoration-[var(--r-alarm)] decoration-dotted underline-offset-[3px]"
        : grounded
          ? "underline decoration-[var(--r-line-2)] decoration-dotted underline-offset-[3px]"
          : undefined;
      const groundedNote = grounded
        ? ` Grounded in ${(world.grounding[row.name] ?? []).join(", ")} of ${world.spec?.fileName ?? "the spec"} — the hairline underline is that citation, and it stays put in every overlay unless drift outranks it.`
        : "";

      const marks = (inner: React.ReactNode) => (
        <ProposedCell
          proposals={proposals}
          onLocate={locate}
          where={`${row.name} at ${typeName}`}
          unsaved={
            overlay === "draft" && unsaved
              ? `UNSAVED — ${
                  diskValue === null
                    ? `"${row.name}" is not in the file at all; saving adds it, resolving to ${draftValue} at ${typeName}.`
                    : `the file resolves ${typeName} to ${diskValue}; saving writes ${draftValue}.`
                } The square sits opposite pea's fold so the two marks can never be confused.`
              : null
          }
        >
          {inner}
        </ProposedCell>
      );

      // ── ⇄ LIVE: Revit's number, in the cell it is a reading of ──────────────────────────────
      if (overlay === "live") {
        if (world.missingInRevit.has(row.name))
          return marks(
            <ReadCell
              className={cn("leading-7 italic text-caution", underline)}
              value="not in Revit"
              reason={`${MARK_TITLE["only-profile"]}${groundedNote}`}
            />,
          );
        const entry = draft.live[row.name]?.[typeName];
        if (!entry)
          return marks(
            <ReadCell
              className={cn("leading-7 text-ink-mute", underline)}
              value="·"
              reason={`${MARK_TITLE.unread} Re-read the family before treating this dot as a match.${groundedNote}`}
            />,
          );
        return marks(
          <ReadCell
            className={cn(
              "leading-7",
              drifted && "text-alarm",
              entry.readOnly && "italic text-ink-2",
              underline,
            )}
            value={entry.value}
            reason={
              drifted
                ? `DRIFT — Revit carries ${entry.value} at ${typeName}; the draft resolves to ${draftValue}. ${MARK_TITLE.drift} Read-only here: editing a live number is not a thing that exists, which is why apply is the write path and its verbs are lit in this overlay.${groundedNote}`
                : `${typeName} — ${entry.value}. ${MARK_TITLE[agreementOf(world, draft, row, typeName)]}${groundedNote}`
            }
          />,
        );
      }

      // ── ⇄ SAVED: the disk's number, and what save would write over it ───────────────────────
      if (overlay === "saved") {
        if (diskValue === null)
          return marks(
            <ReadCell
              className={cn("leading-7 italic text-caution", underline)}
              value="new — not on disk"
              reason={`"${row.name}" is not in the saved profile at all: this page created it. Saving adds the whole parameter, and this type will resolve to ${draftValue}.${groundedNote}`}
            />,
          );
        const willWrite = diskValue !== draftValue;
        return marks(
          <ReadCell
            className={cn("leading-7", willWrite ? "text-caution" : "text-ink-2", underline)}
            value={
              <>
                {diskValue || "—"}
                {willWrite && <span className="ml-1">→</span>}
              </>
            }
            reason={
              willWrite
                ? `The file resolves ${typeName} to ${diskValue || "nothing"}; saving writes ${draftValue} over it. The caution arrow is the direction of that write — it is a warning, not a drift: nothing about Revit is claimed here.${groundedNote}`
                : `The file already resolves ${typeName} to ${diskValue}. Saving writes nothing into this cell.${groundedNote}`
            }
          />,
        );
      }

      // ── DRAFT: the staged document, editable ────────────────────────────────────────────────
      //
      // NOT migrated onto the editable `StateCell` (adoption pass 2026-08-16, findings #13/#14):
      // an override-less type cell shows the FAMILY value as a placeholder — the inheritance
      // showing through, not a value the type holds — and the grammar's editable slot has no
      // placeholder, so an empty `StateCell` here would claim "no value" where the cell resolves
      // to the authored one. The fold also LOCATES here (the notch is a button); `StateCell`'s
      // fold is CSS. Both stay honest on `ProposedCell` + `TextCell` until the axes can say them.
      if (isFormula(authored))
        return (
          <ReadCell
            className={cn("leading-7 italic text-ink-2", options.align === "right" && "text-right")}
            value="ƒ driven"
            reason={`LOCKED — the family level drives this with ${authored}, so a type cannot override its result. The formula is shown on the parameter's own cell; change what feeds it instead. Switch to ⇄ live to see the number Revit computes for it.`}
          />
        );
      const override = draft.types[typeName]?.[row.name];
      return marks(
        <TextCell
          value={override ?? ""}
          placeholder={authored}
          className={cn(
            "placeholder:text-ink-mute",
            proposals.length > 0 && "text-pea-ink",
            options.align === "right" && "text-right",
            underline,
          )}
          title={
            proposals.length > 0
              ? `Pea proposes ${proposals[0]!.proposed} here — but this cell is ORDINARY. Type your own value and the proposal is severed on the spot: no accept, no deny, the card settles to "superseded by your edit". ${override === undefined ? `Until then the type inherits ${authored || "nothing"}.` : `The type currently overrides with ${override}.`}${groundedNote}`
              : override === undefined
                ? `"${typeName}" inherits ${authored || "nothing"} from the family — the grey number is the inheritance showing through, not a value this type holds. Type here to make it differ.${drifted ? ` The alarm underline says Revit disagrees; switch to ⇄ live to read its number in place.` : ""}${groundedNote}`
                : `"${typeName}" overrides the family value ${authored} with ${override}. Clear the cell to go back to inheriting.${drifted ? ` The alarm underline says Revit disagrees; switch to ⇄ live to read its number in place.` : ""}${groundedNote}`
          }
          onCommit={(next) => editOverride(row.name, typeName, next)}
        />,
      );
    },
  });

  // Every column carries a group, including the identity ones. A grouped table renders two
  // header rows; a column WITHOUT a group spans both, and a spanning cell distorts the first
  // row's measured height — which is exactly what the sticky offset is measured from, so the
  // group labels end up hidden under the leaf row. Uniform grouping keeps the two rows honest.
  /* The row's verdict rides the meaning band via the
     narrow tone union — `stateColumn` and its unconstrained CSS-string tone are gone). */
  const rowVerdict = (row: PRow): Verdict => {
    if (row.kind === "ghost")
      return {
        word: "unbound",
        tone: "caution",
        note: `UNBOUND — ${row.name} is a bindable dimension with no parameter driving it. It is not drift and it is not disagreement: both sides carry the same number. It is UNREACHABILITY, and the only verb that answers it is bind.`,
      };
    const state = rowAgreement(world, draft, row);
    return {
      word: state,
      tone: AGREEMENT_TONE[state],
      dim: state === "agree" || state === "unread",
      note: MARK_TITLE[state],
    };
  };
  const stateCol = (state: MasterTableState): Column<PRow> => ({
    key: "state",
    label: "state",
    title:
      "The row's worst verdict across all three types — what this parameter is most asking of you. Filter it to work one kind of trouble at a time. A ghost row's state is `unbound`, which is filterable like any other: that is how you ask the table for every number in this family that nothing can reach.",
    group: "PARAMETER",
    width: "w-36",
    facet: (row) => rowVerdict(row).word,
    // The state column SURVIVES the live column's death, and is careful about why. It carries no
    // live VALUE — it carries the row's worst agreement, which is a diff and not a reading, and
    // it is the only thing on the page you can filter by ("show me only drift", "show me only
    // unbound"). A facet is a use a cell state cannot serve.
    sort: (row) =>
      pinnedSort(
        row,
        row.kind === "ghost" ? "unbound" : rowAgreement(world, draft, row),
        sortDirOf(state, "state"),
      ),
    // A ghost's state cell carries its ONE crossing. Every other row's verbs live in the doc
    // sidebar or the drill-in, because they are decisions between two substrates; binding is
    // not — there is nothing to weigh, so it belongs on the row it changes.
    cell: (row) =>
      row.kind === "ghost" ? ghostStateCell(row) : <VerdictCell verdict={rowVerdict(row)} />,
  });

  /**
   * The bind picker — a plain render FUNCTION, not a component, and deliberately so: a component
   * declared inside the page gets a fresh identity every render, which remounts the open `select`
   * under the pointer. It is also INLINE rather than a popover, because a popover inside a
   * scrolling table has to be positioned against a moving viewport, and the row is already exactly
   * as wide as the choice needs. Cancel is the first option, so the picker can always be left.
   *
   * The same function serves the table and the constituent inspector, so the verb is literally the
   * same verb in both places rather than two that look alike.
   */
  const bindPicker = (
    slug: string,
    property: string,
    dataType: string,
    className?: string,
  ): React.ReactNode => {
    const literal = bindingOf(world, draft, slug, property);
    const open = binding?.slug === slug && binding.property === property;
    const newName = paramNameFor(slug, property);
    const candidates = [...world.paramRows, ...draft.newParams].filter(
      (param) => param.dataType === dataType,
    );

    if (open)
      return (
        <select
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value=""
          aria-label={`bind ${slug}.${property}`}
          title={`Give ${slug}.${property} a parameter. Binding to an EXISTING parameter DISCARDS the ${literal} literal and the dim starts reading that row instead — check the row says what you want before you pick. Binding to a NEW parameter KEEPS ${literal} as that parameter's family value, so the geometry does not move at all and only its reachability changes.`}
          onChange={(event) => {
            const choice = event.target.value;
            if (choice === "") setBinding(null);
            else if (choice === "#new") bindToNew(slug, property, dataType);
            else bindTo(slug, property, choice);
          }}
          className={cn(
            "face-mono h-6 w-full min-w-0 truncate rounded-[2px] border-0 bg-recess px-1 t-caption text-ink outline-none",
            className,
          )}
        >
          <option value="">bind to… (Esc cancels)</option>
          <option value="#new">{`＋ new parameter "${newName}", seeded ${literal}`}</option>
          {/* PREVIEW, not just a name. Binding to an existing parameter DISCARDS the literal and
              the dim starts reading that row — so the option has to say the number it is about to
              inherit, and the one it is about to lose. A picker that showed only names would be
              asking you to approve a value change you cannot see. */}
          {candidates.map((param) => (
            <option key={param.name} value={param.name}>
              {`${param.name} — inherits ${draft.authored[param.name] ?? "nothing"}${
                (draft.authored[param.name] ?? "") === literal
                  ? " (same as now)"
                  : `, discards ${literal}`
              }`}
            </option>
          ))}
        </select>
      );

    return (
      <Verb
        label="bind…"
        className={cn("h-4 px-1 t-caption", className)}
        onClick={() => setBinding({ slug, property })}
        reason={`Bind ${slug}.${property} to a parameter — its one crossing, and the only verb that changes what CAN be said about this number. Offers every ${dataType} parameter already in the profile, or a new one named "${newName}" seeded with ${literal}. The ghost row then disappears into the parameter row that now represents it. Nothing leaves the page.`}
      />
    );
  };

  const ghostStateCell = (row: PRow): React.ReactNode => {
    const slug = row.slug ?? "";
    const property = row.property ?? "";
    const literal = bindingOf(world, draft, slug, property);
    if (binding?.slug === slug && binding.property === property)
      return (
        <span className="flex h-7 items-center px-1">
          {bindPicker(slug, property, row.dataType)}
        </span>
      );
    return (
      <span className="flex h-7 items-center gap-1 px-1.5">
        <StateDot tone="caution" />
        <span
          className="face-mono t-caption text-caution"
          title={`UNBOUND — ${literal} is frozen into the geometry of ${slug}. Nothing in the profile, no type, and no schedule can reach it.`}
        >
          unbound
        </span>
        {bindPicker(slug, property, row.dataType, "ml-auto")}
      </span>
    );
  };

  /**
   * PARAMETER × TYPE, and nothing else.
   *
   * The LIVE column is gone. It was three readings folded into one 52px cell because they had no
   * honest home — and now they have one: the three cells they are readings OF, under the ⇄ live
   * overlay. What survives of it is the agreement FACET on the state column, which is a diff
   * rather than a value, and which the cell overlay genuinely cannot serve: you cannot filter a
   * table by a colour.
   */
  const columns = useMemo<Column<PRow>[]>(() => {
    const list: Column<PRow>[] = [railColumn(), identityColumn(tableState), stateCol(tableState)];
    for (const typeName of world.typeNames) list.push(typeColumn(typeName, { header: true }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, draft, saved, overlay, stageType, binding, consumers, tableState]);

  // ponytail: family still derives order in the component; G7 cutover owed
  const firstGhostKey = useMemo(() => {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    const query = tableState.query.trim().toLowerCase();
    return (
      [...rows]
        .filter(
          (row) =>
            (!query ||
              columns.some((column) => column.search?.(row).toLowerCase().includes(query))) &&
            Object.entries(tableState.filters).every(([key, value]) => {
              const column = byKey.get(key);
              return column?.match?.(row, value) ?? column?.facet?.(row) === value;
            }),
        )
        .sort((left, right) => {
          for (const sort of tableState.sorts) {
            const read = byKey.get(sort.key)?.sort;
            if (!read) continue;
            const before = read(left);
            const after = read(right);
            const order =
              typeof before === "number" && typeof after === "number"
                ? before - after
                : String(before).localeCompare(String(after));
            if (order !== 0) return sort.dir === "desc" ? -order : order;
          }
          return 0;
        })
        .find((row) => row.kind === "ghost")?.key ?? null
    );
  }, [columns, rows, tableState]);

  /**
   * THE DRILL-IN, on the same primitive. Same MasterTable, same identity cell, same editable type
   * cell — narrowed to one type and opened up with the spine. The crossing verbs live ONLY in the
   * pane header (capture <type> / apply <type>): a per-row verb column was tried and retired —
   * the arrows read as claims about direction the cells already carry, and a bulk decision made
   * row-by-row is the surface inventing work. The profile column right-aligns and the live column
   * left-aligns so the two numbers MEET at the spine and every row reads as one diff.
   */
  const drillColumns = useMemo<Column<PRow>[]>(() => {
    if (!drillType) return [];
    const typeName = drillType;
    return [
      railColumn(),
      identityColumn(drillState),
      typeColumn(typeName, { align: "right" }),
      {
        key: "spine",
        label: "spine",
        group: "SPINE",
        width: "w-16",
        facet: (row) => agreementOf(world, draft, row, typeName),
        all: "any agreement",
        title:
          "The seam. Every verb on this page is a crossing between the two sides, so the verdict is read here rather than hunted for in either column.",
        cell: (row) => {
          const state = agreementOf(world, draft, row, typeName);
          return (
            <span
              className="face-mono t-value block px-1.5 text-center"
              style={{ color: VERDICT_INK[AGREEMENT_TONE[state]] }}
              title={MARK_TITLE[state]}
            >
              {MARK[state]}
            </span>
          );
        },
      },
      {
        key: "live",
        label: "revit",
        group: "world.live",
        width: "w-28",
        title: `What Revit carries for the ${typeName} type right now. The profile's number right-aligns and this one left-aligns, so the two meet at the spine and each row reads as ONE diff. Reconciling them is the pane header's job — capture pulls Revit's numbers into the profile, apply writes the profile's numbers into Revit.`,
        cell: (row) => {
          if (world.missingInRevit.has(row.name))
            return (
              <ReadCell
                className="italic text-caution"
                value="missing"
                reason={MARK_TITLE["only-profile"]}
              />
            );
          const entry = draft.live[row.name]?.[typeName];
          const state = agreementOf(world, draft, row, typeName);
          return (
            <ReadCell
              className={cn(
                entry == null && "text-ink-mute",
                state === "drift" && "text-alarm",
                entry?.readOnly && "italic text-ink-2",
              )}
              value={entry?.value ?? "—"}
              reason={
                entry
                  ? `${typeName} — ${entry.value}. ${MARK_TITLE[state]}`
                  : MARK_TITLE[world.missingInRevit.has(row.name) ? "only-profile" : "unread"]
              }
            />
          );
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, draft, saved, overlay, drillType, stageType, binding, consumers, drillState]);

  // ── the anatomy pane ──────────────────────────────────────────────────────────────────────────

  const anatomy = (
    <Pane
      kind="visual"
      title="anatomy"
      meta={
        anatomyCollapsed
          ? "collapsed — the header strip stays so the drawing is one click away"
          : `drawn from the ${stageType} type`
      }
      actions={
        <Verb
          label={anatomyCollapsed ? "show" : "hide"}
          onClick={() => setAnatomyCollapsed((current) => !current)}
          reason={
            anatomyCollapsed
              ? "Show the drawing again. It is drawn from the profile's own numbers for the type on stage — it is a reading of the document, not a render of Revit."
              : "Collapse the drawing. Its header strip stays, so nothing about the page's shape changes except the height."
          }
        />
      }
    >
      <AnatomyDrawing
        world={world}
        draft={draft}
        typeName={stageType}
        model={lane.document?.model ?? null}
        focusedParts={focusedParts}
        focusedParams={focusedParams}
        onFocus={setFocus}
        onInspect={(slug) => setInspect({ kind: "part", slug })}
        inspecting={inspect?.kind === "part" ? inspect.slug : null}
      />
    </Pane>
  );

  // ── the table pane, in whichever mode ─────────────────────────────────────────────────────────

  /**
   * Ghost rows are ORDINARY to the focus and rail laws and marked to the eye, and both halves of
   * that matter. The hairline opens the section; the muted band says "everything below here is a
   * number nothing can reach".
   *
   * That claim survives SORTING: both sortable columns carry a pin rank in front of their key
   * (see pinnedSort), so the partition holds in both directions and the hairline always means the
   * same thing.
   */
  const rowTint = (row: PRow) => {
    const lit =
      row.kind === "ghost"
        ? focusedParts.has(row.slug ?? "")
        : focusedParams.has(row.name) || pinnedParam === row.name;
    return cn(
      row.kind === "ghost" && "bg-[color-mix(in_srgb,var(--r-caution)_6%,transparent)]",
      // The hairline is drawn on whichever ghost is first IN VISIBLE ORDER, not on whichever one
      // the fixture happened to list first — sorting reorders the ghosts among themselves, and a
      // section rule that stayed on a row in the middle of the section would be drawing a boundary
      // that is not there.
      row.key === firstGhostKey && "[&>td]:border-t [&>td]:border-t-line-2",
      // Focus is a FILL and never a hue.
      lit && "bg-select",
    );
  };

  // A ghost row's focus is its CONSTITUENT — it has no parameter to light, and lighting nothing
  // would make the bottom of the table feel disconnected from the drawing it came out of.
  const hoverRow = (row: PRow | null) =>
    setFocus(
      row == null
        ? null
        : row.kind === "ghost"
          ? { kind: "part", id: row.slug ?? "" }
          : { kind: "param", id: row.name },
    );

  const crossType = (
    <MasterTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.key}
      // THE OWED MARKER (fit reviews, ruled 2026-08-16): a ghost row owes exactly one human
      // decision — its bind crossing. Count is always 1; the caution ink matches the band the
      // ghost section already wears.
      gutter={(row) =>
        row.kind === "ghost"
          ? {
              count: 1,
              tone: "caution" as const,
              title: `${row.slug ?? ""}.${row.property ?? ""} is unbound — a bind decision is owed: give it a parameter (its one crossing) or it stays a number nothing can reach`,
            }
          : null
      }
      scopeLabel="parameters"
      searchPlaceholder="parameter"
      onRowHover={hoverRow}
      rowClassName={rowTint}
      tableState={tableState}
      onTableStateChange={setTableState}
      summary={
        <span title="Read left to right: how much of this profile the spec backs, what pea still wants, how many geometry dimensions nothing can reach, how many cells save would write, and where Revit disagrees. The one alarm is spent on drift and nothing else; unbound and unsaved wear caution, because a gap and a pending write are warnings rather than conflicts.">
          {Object.keys(world.grounding).length} grounded · {openProposals.length} open ·{" "}
          {world.typeNames.length} types ·{" "}
          <span className={ghostCount > 0 ? "text-caution" : undefined}>{ghostCount} unbound</span>{" "}
          ·{" "}
          <span className={unsavedCount > 0 ? "text-caution" : undefined}>
            {unsavedCount} unsaved
          </span>{" "}
          ·{" "}
          <span className={driftCells.length > 0 ? "text-alarm" : undefined}>
            {driftCells.length} drift
          </span>
        </span>
      }
      empty={
        // §4's two kinds of empty, told apart: the fixture profile always has rows, so a bare
        // table is almost always the table's OWN narrowing — but the claim is derived, not
        // assumed, so each story renders only when it is true.
        rows.length === 0 ? (
          <EmptyState story="scope" exit="author a parameter, or promote a geometry literal">
            no parameters in this profile — nothing to audit
          </EmptyState>
        ) : (
          <EmptyState story="filter" exit="clear a column filter or the search">
            the narrowing hid all {rows.length} rows
          </EmptyState>
        )
      }
    />
  );

  /** The drill-in is the SAME primitive with a narrower column set — that is the whole claim. */
  const drillIn = drillType ? (
    <MasterTable
      // Ghosts and live-only rows stay OUT of the drill-in: it is a view of one type's profile
      // against Revit, and neither of those rows has a per-type value to reconcile. A ghost here
      // would be three refusals wide in a table two columns narrow.
      rows={rows.filter((row) => row.kind === "profile")}
      columns={drillColumns}
      rowKey={(row) => row.key}
      scopeLabel={`${drillType} · parameters`}
      searchPlaceholder="parameter"
      onRowHover={hoverRow}
      rowClassName={rowTint}
      tableState={drillState}
      onTableStateChange={setDrillState}
      summary={
        <span title="What this one type is asking of you. The same counts as the cross-type table, narrowed to this column of it.">
          {openProposals.filter((entry) => (entry.typeName ?? null) === drillType).length} open ·{" "}
          <span
            className={
              driftCells.some((cell) => cell.typeName === drillType) ? "text-alarm" : undefined
            }
          >
            {driftCells.filter((cell) => cell.typeName === drillType).length} drift
          </span>
        </span>
      }
      empty={
        rows.some((row) => row.kind === "profile") ? (
          <EmptyState story="filter" exit="clear a column filter or the search">
            the narrowing hid every parameter at this type
          </EmptyState>
        ) : (
          <EmptyState story="scope" exit="author a parameter in the profile first">
            no parameters to reconcile at this type — the profile authors none, so there is nothing
            for Revit to agree or disagree with
          </EmptyState>
        )
      }
    />
  ) : null;

  const tablePane = (
    <Pane
      kind="content"
      scroll="clip"
      bodyClassName="flex min-h-0 flex-col"
      // The type's own NAME is the title while drilled in — a pane whose title still said
      // "parameters × types" would be claiming to show something it is not.
      title={drillType ?? "parameters × types"}
      meta={
        drillType
          ? "one type, the same table — profile, spine, live"
          : overlay === "live"
            ? "LIVE OVERLAY — Revit's numbers in place, read-only; the alarm is where it disagrees"
            : overlay === "saved"
              ? "SAVED OVERLAY — what is on disk, read-only; caution is what save would overwrite"
              : "every type, side by side — the spread is the audit"
      }
      actions={
        drillType ? (
          <>
            <Verb
              label="all types"
              tone="nav"
              direction="back"
              onClick={() => setDrillType(null)}
              reason="Leave the drill-in and return to the cross-type table. Nothing is decided by leaving — every mark you did not settle is still standing. Esc does the same."
            />
            <Verb
              label={`capture ${drillType}`}
              disabled={driftCells.every((cell) => cell.typeName !== drillType)}
              onClick={() => captureAll([drillType])}
              reason={
                driftCells.some((cell) => cell.typeName === drillType)
                  ? `Let Revit win on every drifting parameter of the ${drillType} type. Each live value is written into the profile as a ${drillType} override; the model is not touched, so this stays a safe verb.`
                  : `Nothing is drifting at ${drillType}, so there is nothing to pull back.`
              }
            />
            <Verb
              label={`apply ${drillType}`}
              tone="commit"
              disabled={driftCells.every((cell) => cell.typeName !== drillType)}
              onClick={() => applyAll([drillType])}
              reason={
                driftCells.some((cell) => cell.typeName === drillType)
                  ? `Let the profile win at ${drillType}: the authored values are written into the family open in Revit. This MODIFIES the model, which is why it is the only verb here wearing the commit colour.`
                  : `Nothing is drifting at ${drillType}, so an apply would write values Revit already has.`
              }
            />
          </>
        ) : (
          <>
            {/* THE OVERLAY SWITCH — the pseudo-dimension, as three exclusive readings of the same
                cells. It is deliberately the leftmost control in the pane, because it governs what
                every value below it means, and deliberately NOT in the URL. */}
            <Switcher
              ariaLabel="value overlay"
              value={overlay}
              onChange={setOverlay}
              options={(["draft", "live", "saved"] as const).map((choice) => ({
                value: choice,
                label: OVERLAY_LABEL[choice],
                title: OVERLAY_TITLE[choice],
              }))}
            />
            {/* A BULK VERB IS DISABLED UNLESS YOU CAN SEE ITS FAR SIDE (SURFACE-PHILOSOPHY §2).
                Both crossings belong to the LIVE overlay and are refused everywhere else. */}
            <Verb
              label="capture all"
              disabled={overlay !== "live" || driftCells.length === 0}
              onClick={() => captureAll(world.typeNames)}
              reason={
                overlay !== "live"
                  ? "Switch to the ⇄ live overlay first. Capture rewrites the profile with Revit's numbers in bulk, and this is the one view where those numbers are on screen — pressing it from here would be a write you cannot see the far side of."
                  : driftCells.length === 0
                    ? "Nothing is drifting anywhere, so there is nothing to pull back. Capture only ever moves values the two sides disagree about."
                    : `Let Revit win on all ${driftCells.length} drifting cells, across every type — every alarm cell you can see right now. Each live value lands in the profile as that type's override; Revit is not touched.`
              }
            />
            <Verb
              label="apply all"
              tone="commit"
              disabled={overlay !== "live" || driftCells.length === 0}
              onClick={() => applyAll(world.typeNames)}
              reason={
                overlay !== "live"
                  ? "Switch to the ⇄ live overlay first. Apply MODIFIES the family open in Revit; the overlay is where you can see exactly which numbers it would overwrite."
                  : driftCells.length === 0
                    ? "Revit already agrees with the profile everywhere the two can be compared."
                    : `Let the profile win on all ${driftCells.length} drifting cells — every alarm cell on screen goes back to the draft's number. This is the direction that writes into the model, which is why it is the only verb here in the commit colour.`
              }
            />
            {/* THE TWO HOST CROSSINGS, last in the lane and in escalating blast radius: the switch
                changes what you are looking at, capture all / apply all move the draft, and these
                two leave the page. `capture live` reads Revit; `build .rfa` writes an .rfa. */}
            <Verb
              label="capture live"
              busy={capturing}
              disabled={lane.document == null || capturing}
              onClick={() => void captureLive()}
              reason={
                lane.document == null
                  ? "The fixture lane has no session behind it — its live readings are checked into `src/family/world.ts`. Open a real family.json to read Revit."
                  : "Re-read the family open in Revit and re-stamp the evidence — this is what the ⇄ live overlay and the drift marks are readings OF. It moves nothing into the profile: that is capture all, under the overlay. Refuses in Revit's own words if no family document is active there."
              }
            />
            <Verb
              label={BUILD_VERB}
              tone="commit"
              busy={building}
              disabled={lane.document == null || building}
              onClick={() =>
                setArmedBuild({ token: lane.document?.versionToken ?? null, reason: "" })
              }
              reason={
                lane.document == null
                  ? "Nothing to build — this page is reading its declared fixture, which has no file behind it. Pick a document in the sentence first."
                  : `Materialize ${lane.document.relativePath} into a real .rfa inside Revit, at ${buildOutputPath(lane.document.relativePath)}. Pressing this ARMS the ceremony below the header — it does not build. The strip states which family, from which revision, to which path, and refuses out loud if the file on disk is not the file this table is showing.`
              }
            />
          </>
        )
      }
    >
      {/* THE CEREMONY SLOT. It sits inside the pane that owns the crossing, above the table it is
          about, and it is EMPTY until the verb arms it — "never hover-height" (settled law)
          means the reason, the refusals and the receipt all get room at strip scale. The build is a
          whole-family write, so the slot is the same in the drill-in: no type is on the plan. */}
      <BuildStrip
        className="mx-2 mt-2 shrink-0"
        armed={armedBuild}
        building={building}
        said={buildSaid}
        facts={buildFacts}
        familyName={world.familyName}
        count={world.paramRows.length}
        onReasonChange={(reason) =>
          setArmedBuild((previous) => (previous == null ? previous : { ...previous, reason }))
        }
        onCommit={() => void runBuild()}
        onCancel={() => {
          setArmedBuild(null);
          setBuildSaid(null);
        }}
        onReplan={replanBuild}
      />
      {drillIn ?? crossType}
    </Pane>
  );

  // ── the inspector: the doc pane's LOWER HALF ──────────────────────────────────────────────────
  //
  // Two subjects, one slot, because they are the same question: what is true of this THING, rather
  // than of it at some type. A constituent's non-bindable metadata has no honest column — it does
  // not vary by type, half of it is not a number, and half of THAT cannot be edited at all. A
  // parameter's family-level value has no column either, since the one that was pretending to be a
  // fourth type was removed. Both land here, and the pane keeps the spec above them so a citation
  // never leaves the screen while you edit the number it justifies.

  const metaControl = (slug: string, meta: GeomMeta): React.ReactNode => {
    const value = draft.geom[slug]?.meta[meta.key] ?? meta.value;
    if (meta.control === "read")
      return (
        <span
          className="face-mono t-caption text-ink-2"
          title={`${meta.note} READ-ONLY — a box you could type in would be claiming an edit that nothing downstream would actually make.`}
        >
          {value} <span className="t-caption opacity-50">reported</span>
        </span>
      );
    if (meta.control === "toggle")
      return (
        // An exclusive choice among a fixed set, so it wears the mode treatment: the standing
        // option is a neutral FILL, not a colour. It edits the document rather than the view, which
        // is why nothing here is lit — a fill says "this is where you are standing", and that
        // reading is true of a value as much as of a pane.
        <Switcher
          ariaLabel={meta.label}
          value={value}
          onChange={(option) => editMeta(slug, meta.key, option)}
          options={(meta.options ?? []).map((option) => ({
            value: option,
            label: option,
            title:
              value === option
                ? `${meta.label} is ${option} today. ${meta.note}`
                : `Set ${meta.label} to ${option}. ${meta.note}`,
          }))}
        />
      );
    return (
      <select
        value={value}
        onChange={(event) => editMeta(slug, meta.key, event.target.value)}
        title={meta.note}
        aria-label={meta.label}
        className="face-mono h-5 w-full rounded-[2px] border border-line-2 bg-transparent px-1 t-caption outline-none"
      >
        {(meta.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  };

  const partInspector = (part: GeomConstituent): React.ReactNode => (
    <>
      <p
        className="face-mono mb-1.5 t-caption text-ink-2"
        title={`${part.slug} is a ${part.kind}. The kind is READ-ONLY here: a prism does not become a cylinder because a word changed, and the profile's job is to say what the geometry is, not to pretend it can be retyped.`}
      >
        {part.kind} · {part.dims.length} bindable · {part.meta.length} non-bindable
      </p>

      <div className="mb-2 rounded-[2px] border border-line p-1.5">
        <p
          className="face-mono mb-1 t-caption text-ink-2"
          title="The constituent's bindable numbers, shown here as a STATEMENT OF WHERE EACH ONE LIVES rather than as a second place to work. A bound dim names the parameter that represents it in the table; an unbound one carries its literal and the very same bind verb its ghost row carries."
        >
          bindable dims — represented in the table
        </p>
        {part.dims.map((dim) => {
          const bound = boundParam(bindingOf(world, draft, part.slug, dim.property));
          return (
            <div key={dim.property} className="flex items-center gap-2 py-0.5">
              <span
                className="face-mono w-24 shrink-0 truncate t-caption text-ink-2"
                title={dim.note}
              >
                {dim.property}
              </span>
              {bound != null ? (
                <button
                  type="button"
                  onClick={() => {
                    setInspect({ kind: "param", name: bound });
                    setPinnedParam(bound);
                  }}
                  title={`Driven by "${bound}", currently ${draft.authored[bound] ?? "—"}. Click to select that parameter: the value is edited on its row and in its own inspector, never in two places.`}
                  className="face-mono min-w-0 flex-1 truncate text-left t-caption text-ink hover:underline"
                >
                  {bound}
                </button>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    {/* The SAME editable cell as the ghost row it mirrors — one grammar, and the
                        refusal (an emptied literal) is the cell's own note in both places. */}
                    <NavStateCell
                      value={bindingOf(world, draft, part.slug, dim.property)}
                      className="rounded-[2px] border border-line-2 t-caption text-caution"
                      note={`UNBOUND — the literal frozen into ${part.slug}. Editable, exactly as it is on its ghost row at the bottom of the table; editing it changes the number, not who can reach it.`}
                      onCommit={(next) => editLiteral(part.slug, dim.property, next)}
                    />
                  </span>
                  {bindPicker(part.slug, dim.property, dim.dataType)}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-[2px] border border-line p-1.5">
        <p
          className="face-mono mb-1 t-caption text-ink-2"
          title="The half of the constituent no parameter can drive. It has no column in the table because it does not vary by type and it is not a number — and this is the ONLY place it appears, which is exactly the claim: it lives somewhere else."
        >
          non-bindable metadata — lives only here
        </p>
        {part.meta.map((meta) => (
          <div key={meta.key} className="flex items-baseline gap-2 py-0.5">
            <span
              className="face-mono w-24 shrink-0 truncate t-caption text-ink-2"
              title={meta.note}
            >
              {meta.label}
            </span>
            <span className="min-w-0 flex-1">{metaControl(part.slug, meta)}</span>
          </div>
        ))}
      </div>
    </>
  );

  const paramInspector = (name: string): React.ReactNode => {
    const row = rows.find((entry) => entry.name === name && entry.kind === "profile");
    const authored = draft.authored[name] ?? "";
    const drives = consumers.get(name) ?? [];
    const blocks = world.grounding[name] ?? [];
    const family = proposalsAt(name, null);
    return (
      <>
        <p className="face-mono mb-1.5 t-caption text-ink-2">
          {row?.dataType ?? "unknown"} · bound per {row?.isInstance ? "instance" : "type"}
          {row?.group ? ` · ${row.group}` : ""}
          {world.missingInRevit.has(name) && (
            <span className="ml-1 text-caution">⊘ not in Revit</span>
          )}
        </p>

        <div className="mb-2 rounded-[2px] border border-line p-1.5">
          <p
            className="face-mono mb-1 t-caption text-ink-2"
            title="THE FAMILY-LEVEL VALUE — what every type inherits unless it overrides. The table shows it only as the grey placeholder in each type cell, and a placeholder is not an editor; this is where it is actually authored. Type an expression beginning with = to make it a formula instead, which locks every type column on the row."
          >
            family value {isFormula(authored) ? "· formula" : ""}
          </p>
          {/* THE FAMILY-LEVEL VALUE CELL, on the editable `StateCell` (R8, families #6): pea's
              open family-level proposal takes the body (fold + wash), your unwritten edit takes
              the staged square + bold, and a refused empty commit is the cell's own restore +
              caution note — the route's refusal paragraph this replaced is deleted. */}
          <NavStateCell
            value={authored}
            stage={
              family.length > 0
                ? "proposed"
                : (saved.authored[name] ?? null) !== authored
                  ? "staged"
                  : "clean"
            }
            stagedBy={family.length > 0 ? "pea" : "you"}
            className={cn(
              "rounded-[2px] border border-line-2 t-label",
              isFormula(authored) && "italic",
            )}
            note={
              isFormula(authored)
                ? `A FORMULA — ${authored}. Its result is derived, so no type may override it and Revit's number for it is an output rather than a competing value. Edit the expression here; change what feeds it to change the result.`
                : `The value every type inherits unless it authors its own. Editing it moves all ${world.typeNames.filter((typeName) => draft.types[typeName]?.[name] === undefined).length} inheriting type${world.typeNames.filter((typeName) => draft.types[typeName]?.[name] === undefined).length === 1 ? "" : "s"} at once — watch the grey placeholders in the table change. Begin with = to make it a formula.`
            }
            onCommit={(next) => editAuthored(name, next)}
          />
          {family.length > 0 && (
            <p className="face-mono mt-1 t-caption text-pea-ink">
              pea proposes {family[0]!.proposed} here — the card is above; typing your own value
              severs it instead.
            </p>
          )}
        </div>

        <div className="mb-2 rounded-[2px] border border-line p-1.5">
          <p
            className="face-mono mb-1 t-caption text-ink-2"
            title="Every geometry property this parameter drives. These have no rows of their own — this parameter IS their row — so editing the value above moves all of them together. That fan-out is the thing worth knowing before you type."
          >
            drives {drives.length} geometry propert{drives.length === 1 ? "y" : "ies"}
          </p>
          {drives.length === 0 ? (
            <EmptyState story="scope" exit="bind a ghost row to this parameter to fill this list">
              drives nothing — fine for schedule data, suspicious for a Length
            </EmptyState>
          ) : (
            drives.map((entry) => (
              <button
                key={`${entry.slug}.${entry.property}`}
                type="button"
                onClick={() => setInspect({ kind: "part", slug: entry.slug })}
                title={`Open ${entry.slug} — its kind, its other dims, and the non-bindable metadata no parameter can drive.`}
                className="face-mono block w-full truncate text-left t-caption text-ink hover:underline"
              >
                → {entry.slug}.{entry.property}
              </button>
            ))
          )}
        </div>

        <div className="rounded-[2px] border border-line p-1.5">
          <p
            className="face-mono mb-1 t-caption text-ink-2"
            title="Where this number came from. Grounding is its own fact, independent of any proposal — accepting or denying pea's reading never erases the citation."
          >
            grounding
          </p>
          {blocks.length === 0 ? (
            <EmptyState
              story="scope"
              exit={`parse a document that claims this number, or cite a block of ${world.spec?.fileName ?? "the spec"}`}
            >
              ungrounded — asserted, not sourced
            </EmptyState>
          ) : (
            blocks.map((id) => (
              <p
                key={id}
                className="face-mono line-clamp-3 whitespace-pre-line t-caption leading-snug text-ink"
                title={`Block ${id} of ${world.spec?.fileName ?? "the spec"}, verbatim. If it does not say what the value says, the value is wrong.`}
              >
                <span className="text-ink-2">{id} · </span>
                {world.spec?.blocks.find((block) => block.id === id)?.md ?? "(block not found)"}
              </p>
            ))
          )}
        </div>
      </>
    );
  };

  const inspectorPanel =
    inspect == null ? null : (
      <div className="flex max-h-[58%] min-h-0 shrink-0 flex-col border-t-2 border-line">
        <div className="flex h-6 shrink-0 items-center gap-2 border-b border-line bg-recess px-2">
          {/* A machine tag naming the inspected object's kind — the lang tag voice. */}
          <span className="dl-tag shrink-0">
            {inspect.kind === "part" ? "constituent" : "parameter"}
          </span>
          <span className="face-mono min-w-0 flex-1 truncate t-caption text-ink">
            {inspect.kind === "part" ? inspect.slug : inspect.name}
          </span>
          <Verb
            label="esc"
            tone="nav"
            direction="back"
            onClick={() => setInspect(null)}
            reason="Close the inspector and give the pane back to the spec. Esc does the same. Nothing is decided by closing — every edit here landed the moment you made it."
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {inspect.kind === "part"
            ? (world.geomBySlug.get(inspect.slug) ?? null) == null
              ? partProseOnly(world, inspect.slug)
              : partInspector(world.geomBySlug.get(inspect.slug)!)
            : paramInspector(inspect.name)}
        </div>
      </div>
    );

  // ── the doc pane: ONE sidebar, two modes, proposals docked on top ──────────────────────────────

  const docPane = (
    <Pane
      kind="inspector"
      // The pane is a COLUMN: the spec and its proposals scroll in the upper half, the inspector
      // docks under them. Neither displaces the other — an inspector that replaced the spec would
      // take away the evidence at the exact moment you edit the number it justifies.
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
      title="doc"
      meta={
        world.spec
          ? `${world.spec.fileName} · ${world.spec.blocks.length} blocks`
          : "no spec attached"
      }
      actions={
        <>
          <FactChip
            tone="pea"
            className="mr-1"
            title="Open proposals waiting on a verdict. They are ephemeral — page-scoped, never written, gone on reload. Only accept makes one real."
          >
            {openProposals.length} open
          </FactChip>
          <Switcher
            ariaLabel="doc mode"
            value={docMode}
            onChange={setDocMode}
            options={[
              {
                value: "text",
                label: "text",
                title:
                  "Show the spec as OCR read it: markdown blocks, checkable word for word. This is what a citation actually resolves to.",
              },
              {
                value: "sheet",
                label: "sheet",
                title:
                  "Show the spec as a page: the block boxes where they sit on the sheet, so a citation can be located by eye. STAND-IN — the real surface renders the PDF here through the grounded-doc camera.",
              },
            ]}
          />
          <Verb
            label="parse"
            onClick={() =>
              say(
                world.spec
                  ? `re-parsed ${world.spec.fileName} — ${world.spec.blocks.length} blocks`
                  : "No spec is attached to this profile, so there is nothing to re-read. Parsing one is route:family's parse_spec command, which this page does not yet run.",
              )
            }
            reason="Read the source document again and rebuild its blocks. Parsing is the doc pane's own verb — it changes what can be cited, and nothing about the profile."
          />
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* proposals — margin annotations, docked as a stack above the spec */}
        <div className="border-b border-line p-2">
          <p
            className="face-mono mb-1 t-caption text-ink-2"
            title="Pea's reading of the spec, aimed at named cells. Accepting moves the value into the table where you can see it land; the citation stays lit either way, because the grounding is a separate fact from the proposal."
          >
            pea proposes — ephemeral, page-scoped
          </p>
          {world.proposals.length === 0 ? (
            <EmptyState story="scope" exit="ask pea to read the attached spec against the family">
              no proposals — pea has not read this spec against the profile
            </EmptyState>
          ) : (
            world.proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                verdict={verdictOf(proposal.id)}
                // A card lights either because it is the one you located, or because its whole ROW
                // is the one you located — the two-proposal case has to light both cards or the
                // count on the rail would be pointing at something the sidebar refuses to show.
                focused={focusedProposal === proposal.id || pinnedParam === proposal.param}
                blockMd={
                  world.spec?.blocks.find((block) => block.id === proposal.sourceBlockId)?.md ??
                  null
                }
                specFileName={world.spec?.fileName ?? null}
                onAccept={() => accept(proposal)}
                onDeny={() => deny(proposal)}
                onHover={(on) => {
                  setFocus(on ? { kind: "param", id: proposal.param } : null);
                  setFocusedProposal(on ? proposal.id : null);
                }}
                register={(node) => {
                  cardRefs.current[proposal.id] = node;
                }}
              />
            ))
          )}
        </div>

        {docMode === "text" ? (
          <SpecText spec={world.spec} litBlocks={litBlocks} />
        ) : (
          <SpecSheet spec={world.spec} litBlocks={litBlocks} zoom={docZoom} onZoom={setDocZoom} />
        )}
      </div>

      {inspectorPanel}
    </Pane>
  );

  return (
    <main className="flex h-screen min-h-0 flex-col bg-page text-ink">
      {/* ── ONE head rail (lang AddressingBar — the five-slot rule this head proved).
             Everything else — the overlay switch, the crossings, the doc's own verbs — lives
             in the pane that owns it, so no fact and no verb is ever far from the thing it
             describes (SURFACE-PHILOSOPHY §4). ── */}
      <AddressingBar
        name="family"
        sentence={
          <Sentence
            prefix={
              openProposals.length > 0 ? `${openProposals.length} proposals against` : "editing"
            }
            prefixTone={openProposals.length > 0 ? "awaiting" : "rest"}
            documentLabel={world.path}
            /* THE DOCUMENT SLOT IS THE LANE SWITCH — there is no separate mode toggle, which is
               the Sentence's own law. The list is always what the bound session can SEE, and the
               label is always what the page is READING: on the fixture lane those disagree, which
               is exactly the honest state (the label names the fixture, the list offers the way
               out). Picking one runs settings `open`; nothing else on the page changes shape. */
            documents={store.documents}
            onPickDocument={openDocument}
            documentsEmpty="No family.json is visible from here — bind a world in the clause to the right, or author one under FamilyFoundry/models. Until one is open this page reads its declared fixture, and says so."
            slots={[
              {
                key: "family",
                joiner: "against",
                text: world.live ? `${world.live.familyName} in ${world.live.worldLabel}` : null,
                placeholder: "nothing live",
                options: null,
                title:
                  "The family open in the bound Revit session — what the ⇄ live overlay reads and the only thing apply writes into. Without it the profile still edits; it just cannot disagree with anything.",
              },
            ]}
            target={target}
            onBind={(selector) => {
              setTarget(selector ?? "");
              // Pointing the page at a different world changes WHICH documents it can see, so the
              // list is re-read in the same beat rather than going quietly stale.
              store.refreshDocuments();
            }}
            receipt={receipt}
          />
        }
        facts={
          <>
            {world.live && (
              <FactChip
                tone={lane.document?.evidenceStale ? "caution" : "meta"}
                title={
                  lane.document?.evidenceStale
                    ? "STALE — this read was stamped with a different revision of the document than the one you are editing, so every claim under the ⇄ live overlay describes a family that has moved since. Capture again before trusting it."
                    : "How long ago the live family was read. Every claim under the ⇄ live overlay is only as true as this number — an old read is a weaker claim, not a wrong one."
                }
              >
                live · read {world.live.readAgo}
                {lane.document?.evidenceStale ? " · stale" : ""}
              </FactChip>
            )}
            {validation && (
              <FactChip
                tone={validation.isValid ? "done" : "caution"}
                title={
                  validation.isValid
                    ? "The host validated this document against its schema on the last read or save, and it passed."
                    : `The host reports ${validation.issues.length} schema issue(s) in the saved document: ${validationSays}`
                }
              >
                {validation.isValid
                  ? "schema valid"
                  : `${validation.issues.length} schema issue${validation.issues.length === 1 ? "" : "s"}`}
              </FactChip>
            )}
            <FactChip
              tone={draft.dirty ? "caution" : "meta"}
              title={
                draft.dirty
                  ? "The profile document has changes that are not on disk — an edit, an accepted proposal, or a capture. Nothing about Revit is implied by this; it is a fact about the file."
                  : "The profile on disk matches what you are looking at. Edits and accepted proposals flip this the moment they land."
              }
            >
              {draft.dirty ? `unsaved draft · ${unsavedCount}` : "saved"}
            </FactChip>
          </>
        }
        verb={
          <Verb
            label="save profile"
            tone="commit"
            busy={saving}
            onClick={() => void save()}
            disabled={!draft.dirty || saving}
            reason={
              !draft.dirty
                ? "Nothing to save — the document already matches the file."
                : lane.document
                  ? `Stage every value you moved and write them into ${lane.document.relativePath} through route:settings, under the version token this snapshot was read at. If someone else saved first the write is REFUSED rather than merged, and the reason lands on the sentence verbatim. It touches nothing in Revit — that is what apply is for.`
                  : `Write the profile back to ${world.path}. This commits the DOCUMENT — it touches nothing in Revit, which is what apply is for.`
            }
          />
        }
        advisory={
          /* Two advisories, and only ever one at a time — the second is strictly worse news.
             A document that is OPEN but unparseable must never quietly become the fixture. */
          lane.parseError != null ? (
            <OutcomeLine
              kind="error"
              label="the open document will not parse"
              says={`${store.snapshot?.documentId.relativePath ?? "it"} — ${lane.parseError}. The page below is the declared fixture, NOT your file; fix the JSON and re-read.`}
            />
          ) : requestedFamily != null ? (
            <OutcomeLine
              kind="advisory"
              label={`?family=${requestedFamily} ignored`}
              says="this surface opens an authored family.json, not a placed element — pick the document in the sentence"
            />
          ) : undefined
        }
        seam={
          lane.document ? (
            /* THE LIVE LANE'S CHIP. Not dashed: nothing is standing in. It names what you are
               actually editing and the token the next save will be guarded by, because "which
               revision" is the fact a save can refuse over. */
            <FactChip
              title={`LIVE — reading ${lane.document.relativePath} through route:settings. The version token guards the next save: if the file moved underneath you, the write is REFUSED rather than merged. Capture, apply and pea's proposals stay page-local.`}
            >
              {lane.document.versionToken
                ? `live · v${lane.document.versionToken}`
                : "live · untokened"}
            </FactChip>
          ) : (
            <FactChip
              dashed
              title="FIXTURE LANE, declared rather than fallen back to. Every value, proposal and live reading on this page comes from the checked-in world in `src/family/world.ts`; no host, no store, no network, and every verb rewrites page-local state. What replaces it: route:settings for the document, family.editor.snapshot/apply for the live half, and the grounded-doc camera for the sheet mode."
            >
              fixture · no host
            </FactChip>
          )
        }
      />

      <PaneWorkspace
        className="min-h-0 flex-1"
        visual={anatomy}
        content={tablePane}
        inspector={docPane}
        inspectorSpan="full"
        resize={{
          visual: {
            defaultSize: 240,
            minSize: 34,
            collapse: {
              collapsed: anatomyCollapsed,
              onCollapsedChange: setAnatomyCollapsed,
              collapsedSize: 34,
              collapseBelow: 90,
            },
          },
          inspector: { defaultSize: 340, minSize: 260, minOtherSize: 560 },
        }}
      />
    </main>
  );
}

/** A constituent the profile names in prose but declares no structured geometry for. */
function partProseOnly(world: PageWorld, slug: string) {
  const prose = world.constituents.find((entry) => entry.slug === slug)?.text ?? null;
  return (
    <EmptyState story="scope" exit="declare its geometry in the profile to make it editable here">
      no structured geometry declared for {slug}
      {prose ? ` — the profile says only: ${prose}` : ""}
    </EmptyState>
  );
}
