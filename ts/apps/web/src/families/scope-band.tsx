import { sameValue, type AppliedFilter, type FamiliesRouteDocument } from "@pe/agent-contracts";

import { reviewTransitions, type CellWire } from "#/components/lang/band";
import { cellFromTrichotomy, StateCell } from "#/components/lang/cell";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { ListPopup } from "#/components/lang/list-popup";
import { LoadedFamilyPlacement } from "#/host/loaded-families-view";
import { NamePicker, SectionLabel } from "#/families/readout-primitives";
import { useFamiliesWorkspace } from "#/families/workspace-context";

const PLACEMENT_LABELS: Record<LoadedFamilyPlacement, string> = {
  [LoadedFamilyPlacement.AllLoaded]: "all loaded",
  [LoadedFamilyPlacement.PlacedOnly]: "placed only",
  [LoadedFamilyPlacement.UnplacedOnly]: "unplaced only",
};
const PLACEMENT_NOTES: Record<LoadedFamilyPlacement, string> = {
  [LoadedFamilyPlacement.AllLoaded]:
    "Every family loaded into the project, placed or not — this also catches library families sitting unused in the file.",
  [LoadedFamilyPlacement.PlacedOnly]:
    "Only families with at least one placed instance — what the project actually uses. Narrower scope, cheaper matrix.",
  [LoadedFamilyPlacement.UnplacedOnly]:
    "Only families with no placed instance — the loaded-but-unused tail, usually the purge conversation.",
};
const PLACEMENT_OPTIONS = (Object.keys(PLACEMENT_LABELS) as LoadedFamilyPlacement[]).map(
  (value) => ({ value, label: PLACEMENT_LABELS[value], note: PLACEMENT_NOTES[value] }),
);

/** A scope in words: its categories, its families, its placement. */
export const filterWords = (scope: AppliedFilter) =>
  `${scope.categoryNames.join(", ") || "every category"} · ${scope.familyNames.join(", ") || "every family"} · ${PLACEMENT_LABELS[scope.placementScope as LoadedFamilyPlacement]}`;

/** Pea's scope proposal while it still stands (present, and not what is staged), else null. */
export const standingFilterProposal = (scope: FamiliesRouteDocument["scope"]) =>
  scope.proposal && !sameValue(scope.proposal, scope.staged) ? scope.proposal.value : null;

/**
 * Pea's scope proposal as the one scope cell (F-J1-10): the scope sits at the Work's root, and
 * its verbs are exactly the contract's (`reviewTransitions`). A person's own apply stages beside
 * it, so a differing proposal stays drawn as the counter-proposal.
 */
export function PeaFilterProposal({
  scope,
  wire,
}: {
  scope: FamiliesRouteDocument["scope"];
  wire: CellWire;
}) {
  const proposed = standingFilterProposal(scope);
  if (!proposed) return null;
  const show = (value: unknown) => filterWords(value as AppliedFilter);
  // The scope is a root cell: the matrix's per-cell lock/baseline read family cell keys (F-H6-7).
  const scopeWire: CellWire = { segment: null, write: wire.write, revision: wire.revision };
  return (
    <div className="hairline-b flex flex-wrap items-baseline gap-1.5 px-2 py-1">
      <SectionLabel>scope</SectionLabel>
      <span className="t-small">Pea proposes</span>
      <StateCell
        {...cellFromTrichotomy(scope, { value: show(proposed) }, show)}
        transitions={reviewTransitions(scopeWire, "scope", scope)}
      />
    </div>
  );
}

export function FamiliesFilterBand() {
  const {
    fixture,
    placement,
    setPlacement,
    draftCategories,
    categories,
    setDraftCategories,
    pickedFamilies,
    draftFamilyNames,
    setPickedFamilies,
    familyFeed,
    categoryFeed,
    workUnreadable,
    store,
    wire,
  } = useFamiliesWorkspace();
  const scope = store.handle.work.doc?.scope;
  return (
    <>
      {scope && !workUnreadable ? <PeaFilterProposal scope={scope} wire={wire} /> : null}
      {/* ── scope: placement → draft categories → picked families, explicit apply ────────── */}
      <div className="hairline-b flex flex-wrap items-center gap-1.5 px-2 py-1">
        <SectionLabel>
          <span title="Which families the table loads at all. Scope is a DRAFT until you apply it — the matrix op is the expensive one, so it never fires on a click.">
            scope draft
          </span>
        </SectionLabel>
        <div className="face-mono w-32">
          <ListPopup<(typeof PLACEMENT_OPTIONS)[number]>
            anchor="trigger"
            face="fill"
            triggerLabel="placement filter"
            title="Whether to include families that are loaded but never placed. It filters BOTH pickers beside it, so narrowing here changes which families the draft resolves to."
            trigger={PLACEMENT_LABELS[placement]}
            aria-label="placement"
            items={PLACEMENT_OPTIONS}
            keyOf={(option) => option.value}
            labelOf={(option) => option.label}
            disabled={workUnreadable}
            select="single"
            selected={[placement]}
            empty="no placements"
            onPick={(option) => setPlacement(option.value)}
            row={(option) => ({ label: option.label, sub: option.note, lines: 2 })}
          />
        </div>
        {categoryFeed.state === "loading" ? (
          <div className="min-w-0 flex-1">
            <OutcomeLine kind="busy" label="reading categories" />
          </div>
        ) : categoryFeed.options === null ? null : categories.length === 0 ? (
          // Only an answered read says "none"; an unanswered one (no document yet) draws nothing.
          <div className="min-w-0 flex-1">
            <EmptyState story="scope" exit="bind a different world in the sentence above">
              no categories — the category-names read succeeded and reported none
            </EmptyState>
          </div>
        ) : (
          <>
            <NamePicker
              options={categories}
              values={draftCategories}
              onChange={(next) => setDraftCategories([...next].sort((a, b) => a.localeCompare(b)))}
              placeholder="add categories…"
              disabled={workUnreadable}
              ariaLabel="draft categories"
              title="Which Revit categories the draft asks for. Picking one only edits the DRAFT — nothing loads until you apply the scope, because the matrix op is the expensive one."
            />
            <NamePicker
              options={draftFamilyNames}
              values={pickedFamilies}
              onChange={setPickedFamilies}
              disabled={workUnreadable || draftFamilyNames.length === 0}
              placeholder={
                draftCategories.length === 0
                  ? "pick categories first"
                  : draftFamilyNames.length > 0
                    ? `pick from ${draftFamilyNames.length} resolved families`
                    : !fixture && (familyFeed.state === "loading" || familyFeed.stale)
                      ? "resolving families…"
                      : "no families resolved"
              }
              ariaLabel="draft families"
              title="Every family the draft categories resolve to, all picked by default. Dropping one narrows exactly what apply asks the matrix op for — it does not filter a loaded table, it loads less."
            />
          </>
        )}
        {/* RULED 2026-08-16 (fit reviews): the third EmptyState that sat here — "no categories
            picked yet" — is deleted; the two visibly-empty pickers beside it announce
            themselves. The matrix count is the Situation sentence's scope slot. */}
        {draftCategories.length !== 0 &&
        !fixture &&
        ((draftFamilyNames.length === 0 && familyFeed.state === "loading") || familyFeed.stale) ? (
          <div>
            <OutcomeLine kind="busy" label="resolving families" />
          </div>
        ) : null}
      </div>
    </>
  );
}
