/**
 * /family — the CELL MARKS: what a TYPE-OVERRIDE cell says about itself beyond its value.
 *
 * ═══ WHY THIS FILE STILL EXISTS AFTER THE EDITABLE `StateCell` SHIPPED (R8) ═════════════════
 * The consolidation batch delivered the editable `StateCell`, and the ghost literal cell and the
 * inspector's family-value editor now ride it — their refusal (`RefusalNote`, which used to live
 * here) folded into the primitive and was DELETED. `ProposedCell` survives for exactly two
 * reasons:
 *
 *   1. INHERITED-PLACEHOLDER SEMANTICS (#13). A type cell with no override shows the family
 *      value as a grey placeholder — the inheritance showing through, not a value the type
 *      holds. `StateCell`'s editable slot has no placeholder, so an empty `StateCell` would
 *      claim "no value" where the cell resolves to the authored one. That is a lie the axes
 *      cannot currently avoid, so the type cells keep the honest `TextCell` + this wrapper.
 *   2. THE FOLD IS A LOCATOR HERE (#14). `StateCell`'s proposal fold is CSS, not a control;
 *      this route's notch is a button that brings the proposal card into the sidebar. Until
 *      the primitive grows a locate hook, migrating the fold would delete the affordance.
 *
 * The roles are the REAL ones (`--pe-pea`, `--pe-pea-ink`, `--pe-caution`), so when those two gaps
 * close the migration here is still a deletion, not a redesign.
 *
 * What `ProposedCell` deliberately does NOT do is capture the cell. The child is whatever the
 * column would have rendered anyway — usually an editable input — and it stays fully editable:
 * no click handler on the wrapper to swallow a caret placement, no overlay across the text, no
 * refocus. Typing beats proposing, and a wrapper that intercepted the pointer would make that a
 * lie ("do not steal the caret", SURFACE-PHILOSOPHY §4).
 */
import { StateCell, type StateCellProps } from "#/components/lang/cell";
import { useCellNavigation } from "#/components/master-table/cell-navigation";
import type { ProtoProposal } from "#/family/world";
import { cn } from "#/lib/utils";

/**
 * The editable `StateCell`, wired to whatever cell navigation surrounds it. Inside a MasterTable
 * the provider is present and Enter/Tab/arrows walk the grid; in the inspector there is no
 * provider and the hook returns null, so the cell simply blurs — one component, both homes.
 */
export function NavStateCell(props: StateCellProps) {
  const move = useCellNavigation();
  return <StateCell scale="row" {...props} onNavigate={move ?? undefined} />;
}

export function ProposedCell({
  proposals,
  where,
  onLocate,
  unsaved,
  children,
}: {
  proposals: ProtoProposal[];
  /** Human name for the cell, for the notch's tooltip. */
  where: string;
  onLocate: (proposal: ProtoProposal) => void;
  /**
   * A string means "saving would write here", and the string itself says what. It renders as a
   * 4px caution square in the BOTTOM-LEFT corner: diagonally opposite pea's fold, so the two can
   * never overlap, never touch, and never be read as one mark. Caution because a pending write is
   * a WARNING (it is about to change the file), not a drift (`--pe-alarm`, which means the model
   * disagrees) and not a commitment (`--pe-commit`, which belongs to the verb).
   */
  unsaved?: string | null;
  children: React.ReactNode;
}) {
  const first = proposals[0];
  if (!first && !unsaved) return <>{children}</>;

  return (
    <span
      className={cn(
        "relative flex min-h-7 w-full items-center",
        first && "border-b-[1.5px] border-pea",
      )}
    >
      {children}
      {unsaved && (
        <span
          aria-hidden
          title={unsaved}
          className="absolute bottom-px left-px z-20 size-1 rounded-[1px] bg-caution"
        />
      )}
      {first && (
        <ProposalNotch first={first} count={proposals.length} where={where} onLocate={onLocate} />
      )}
    </span>
  );
}

function ProposalNotch({
  first,
  count,
  where,
  onLocate,
}: {
  first: ProtoProposal;
  count: number;
  where: string;
  onLocate: (proposal: ProtoProposal) => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      // Do not take focus from the input on the way down — the notch is a pointer, not an editor.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onLocate(first)}
      aria-label={`locate the proposal for ${where}`}
      title={`Pea proposes ${first.proposed} for ${where}${count > 1 ? ` (and ${count - 1} more on this cell)` : ""}. ${first.note} — click the notch to bring the card into the sidebar. The cell itself is ORDINARY: type your own value and the proposal is severed, with no verdict to give. The fold survives every overlay, because a proposal is a fact about the cell rather than about which reading is showing.`}
      className="absolute right-0 top-0 z-20 size-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-pea"
    />
  );
}
