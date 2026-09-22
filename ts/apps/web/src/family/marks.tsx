/**
 * /family — the ONE cell wrapper this route still owns: navigation wiring, and nothing else.
 *
 * ═══ WHAT DIED HERE (2026-08-31, proposal-state demiurge + per-cell grounding) ═══════════════
 * `ProposedCell` and its `ProposalNotch` are deleted. They existed for exactly two gaps in the
 * grammar, and the consolidation closed both:
 *
 *   1. INHERITED-PLACEHOLDER SEMANTICS (#13). `StateCellProps.placeholder` exists, so a type cell
 *      with no override can show the family value as the inheritance showing through, honestly,
 *      inside the editable slot.
 *   2. THE FOLD AS A LOCATOR (#14). `StateCellProps.onLocate` exists — a click on the cell BODY
 *      brings the proposal card into the doc sidebar — so the 24px icon-press improvised inside a
 *      20px row has nothing left to do.
 *
 * The migration was a deletion, exactly as this file's old note predicted. The cells now build
 * their props through `cellFromTrichotomy`, so no reading of a proposal is written here twice.
 */
import { StateCell, type StateCellProps } from "#/components/lang/cell";
import { useCellNavigation } from "#/components/master-table/cell-navigation";

/**
 * The editable `StateCell`, wired to whatever cell navigation surrounds it. Inside a Table
 * the provider is present and Enter/Tab/arrows walk the grid; in the inspector there is no
 * provider and the hook returns null, so the cell simply blurs — one component, both homes.
 */
export function NavStateCell(props: StateCellProps) {
  const move = useCellNavigation();
  return <StateCell scale="row" {...props} onNavigate={move ?? undefined} />;
}
