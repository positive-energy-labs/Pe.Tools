/**
 * /family — the CELL MARKS: the two things a value cell may say about itself beyond its value,
 * plus the refusal that lands beside a cell that would not take one.
 *
 * ═══ WHY THESE ARE HERE AND NOT `components/lang/cell.tsx` ══════════════════════════════════
 * `StateCell` already specifies both of these marks, in exactly these positions, on exactly
 * these roles: the top-right fold is `stage: "proposed"` with `stagedBy: "pea"`, and the
 * bottom-left square is `stage: "staged"` with `stagedBy: "you"`. This file re-implements them
 * for ONE reason: **`StateCell` renders text, never an input**, and every value cell on this
 * surface is an editable input. See DESIGN-AUDIT #6 — this route is the strongest argument for
 * an editable `StateCell`, because it is 100% editable cells and it independently arrived at
 * the grammar's own marks.
 *
 * The roles are therefore the REAL ones (`--r-pea`, `--r-pea-ink`, `--r-caution`), so that when
 * the primitive grows an editable variant the migration here is a deletion, not a redesign.
 *
 * What `ProposedCell` deliberately does NOT do is capture the cell. The child is whatever the
 * column would have rendered anyway — usually an editable input — and it stays fully editable:
 * no click handler on the wrapper to swallow a caret placement, no overlay across the text, no
 * refocus. Typing beats proposing, and a wrapper that intercepted the pointer would make that a
 * lie ("do not steal the caret", SURFACE-PHILOSOPHY §4).
 */
import type { ProtoProposal } from "#/family/world";

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
   * a WARNING (it is about to change the file), not a drift (`--r-alarm`, which means the model
   * disagrees) and not a commitment (`--r-commit`, which belongs to the verb).
   */
  unsaved?: string | null;
  children: React.ReactNode;
}) {
  const first = proposals[0];
  if (!first && !unsaved) return <>{children}</>;

  return (
    <span
      className="relative flex min-h-7 w-full items-center"
      style={first ? { boxShadow: "inset 0 -1.5px 0 0 var(--r-pea)" } : undefined}
    >
      {children}
      {unsaved && (
        <span
          aria-hidden
          title={unsaved}
          className="absolute bottom-px left-px z-20 size-1 rounded-[1px] bg-[var(--r-caution)]"
        />
      )}
      {first && (
        <ProposalNotch first={first} count={proposals.length} where={where} onLocate={onLocate} />
      )}
    </span>
  );
}

/**
 * A refused commit, said WHERE it was refused. Absolutely positioned so it cannot change the row's
 * height (SURFACE-PHILOSOPHY §3: a rejected commit restores the value AND says why, near the cell,
 * without resizing the row), caution because a refusal is a warning rather than the model
 * disagreeing, and dismissible because a message that will not go away becomes noise on the row it
 * is trying to explain. The full reason is the title; the chip is only as wide as the word.
 *
 * DESIGN-AUDIT #9: `components/lang` has no cell-scoped refusal — `Verb.reason` covers a CONTROL
 * refusing, and `OutcomeLine` is a block-level lane. This is the gap, drawn honestly.
 */
export function RefusalNote({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onDismiss}
      title={`${text} — click to dismiss this mark. Your value was put back; nothing was written.`}
      className="tele absolute right-0.5 top-1/2 z-20 -translate-y-1/2 rounded-[2px] border border-[var(--r-caution)] bg-[var(--r-page)] px-1 text-[9px] leading-[13px] text-[var(--r-caution)]"
    >
      ⊘ refused
    </button>
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
      className="absolute right-0 top-0 z-20 size-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-[var(--r-pea)]"
    />
  );
}
