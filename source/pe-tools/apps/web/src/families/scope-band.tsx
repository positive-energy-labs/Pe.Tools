import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { VerbLane } from "#/components/lang/verb-lane";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/lang/select";
import { HostIssuePanel } from "#/host/issues";
import { LoadedFamilyPlacementScope } from "#/host/loaded-families-view";
import { NamePicker, SectionLabel } from "#/families/readout-primitives";
import { useFamiliesWorkspace } from "#/families/workspace-context";

const PLACEMENT_LABELS: Record<LoadedFamilyPlacementScope, string> = {
  [LoadedFamilyPlacementScope.AllLoaded]: "all loaded",
  [LoadedFamilyPlacementScope.PlacedOnly]: "placed only",
  [LoadedFamilyPlacementScope.UnplacedOnly]: "unplaced only",
};
const PLACEMENT_NOTES: Record<LoadedFamilyPlacementScope, string> = {
  [LoadedFamilyPlacementScope.AllLoaded]:
    "Every family loaded into the project, placed or not — this also catches library families sitting unused in the file.",
  [LoadedFamilyPlacementScope.PlacedOnly]:
    "Only families with at least one placed instance — what the project actually uses. Narrower scope, cheaper matrix.",
  [LoadedFamilyPlacementScope.UnplacedOnly]:
    "Only families with no placed instance — the loaded-but-unused tail, usually the purge conversation.",
};

export function FamiliesScopeBand() {
  const {
    fixture,
    store,
    selectedProfileQuery,
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
    connected,
    matrixIssue,
  } = useFamiliesWorkspace();
  return (
    <>
      {selectedProfileQuery?.error && (
        <div className="px-4 py-1.5">
          <OutcomeLine
            kind="error"
            label="profile read failed"
            says={(selectedProfileQuery.error as Error).message}
          />
        </div>
      )}

      {/* ── scope: placement → draft categories → picked families, explicit apply ────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2 py-1">
        <SectionLabel>
          <span title="Which families the table loads at all. Scope is a DRAFT until you apply it — the matrix op is the expensive one, so it never fires on a click.">
            scope draft
          </span>
        </SectionLabel>
        <div className="face-mono w-32">
          <Select
            items={PLACEMENT_LABELS}
            value={placement}
            onValueChange={(value: LoadedFamilyPlacementScope | null) =>
              value && setPlacement(value)
            }
          >
            <SelectTrigger
              aria-label="placement filter"
              title="Whether to include families that are loaded but never placed. It filters BOTH pickers beside it, so narrowing here changes which families the draft resolves to."
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PLACEMENT_LABELS) as LoadedFamilyPlacementScope[]).map((value) => (
                <SelectItem key={value} value={value} title={PLACEMENT_NOTES[value]}>
                  {PLACEMENT_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!connected ? (
          /* A disconnected bridge is not the model disagreeing — it is the machine being
             unavailable, which the outcome lane calls `error` (caution, never alarm). */
          <div className="min-w-0 flex-1">
            <OutcomeLine
              kind="error"
              label="bridge disconnected"
              says="nothing can be read — open Revit with the host connected, then bind that world in the sentence above"
            />
          </div>
        ) : categoryFeed.state === "loading" ? (
          <div className="min-w-0 flex-1">
            <OutcomeLine kind="busy" label="reading categories" />
          </div>
        ) : categories.length === 0 ? (
          <div className="min-w-0 flex-1">
            <EmptyState
              story="scope"
              exit="load a family in Revit, or bind a different world in the sentence above"
            >
              no loaded families in this project — the catalog read succeeded and reported nothing
            </EmptyState>
          </div>
        ) : (
          <>
            <NamePicker
              options={categories}
              values={draftCategories}
              onChange={(next) => setDraftCategories([...next].sort((a, b) => a.localeCompare(b)))}
              placeholder="add categories…"
              ariaLabel="draft categories"
              title="Which Revit categories the draft asks for. Picking one only edits the DRAFT — nothing loads until you apply the scope, because the matrix op is the expensive one."
            />
            <NamePicker
              options={draftFamilyNames}
              values={pickedFamilies}
              onChange={setPickedFamilies}
              disabled={draftFamilyNames.length === 0}
              placeholder={
                draftCategories.length === 0
                  ? "pick categories first"
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
            themselves. */}
        {draftCategories.length === 0 ? null : !fixture &&
          ((draftFamilyNames.length === 0 && familyFeed.state === "loading") ||
            familyFeed.stale) ? (
          <div>
            <OutcomeLine kind="busy" label="resolving families" />
          </div>
        ) : (
          <FactChip title="How many families the draft currently commits to. The matrix budget is sized to exactly this number, so nothing is silently truncated.">
            {pickedFamilies.length === draftFamilyNames.length
              ? `matrix · ${draftFamilyNames.length}`
              : `matrix · ${pickedFamilies.length} / ${draftFamilyNames.length}`}
          </FactChip>
        )}
      </div>

      <div className="border-b border-line px-2 py-1 empty:hidden">
        <VerbLane atoms={store.atoms} />
      </div>
      {matrixIssue && (
        <div className="px-4 py-2">
          <HostIssuePanel issue={matrixIssue} compact />
        </div>
      )}
      {/* ── decision queue: the plan as a lens over the scope ────────────────────────────── */}
    </>
  );
}
