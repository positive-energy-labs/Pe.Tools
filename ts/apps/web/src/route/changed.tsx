/**
 * "changed in Revit" — one drawing of the host's per-document change mark, for every surface that
 * draws a document (design-system ledger, 2026-09-22). The fact is always the host's: a Reading's
 * envelope says a document changed after the read it carries was taken. This says so and offers
 * the re-read; it never measures an age and never decides freshness itself.
 */
import { FactChip } from "#/components/lang/chip";
import { ActionButton } from "#/components/lang/action-button";

export function ChangedInRevit({
  what,
  busy = false,
  disabled = false,
  onReadAgain,
}: {
  /** What reading again re-reads, named in the button's reason. */
  what: string;
  busy?: boolean;
  disabled?: boolean;
  onReadAgain: () => void;
}) {
  return (
    <>
      <FactChip
        tone="caution"
        title="Revit changed this document after this read was taken. Reading again brings it back to what Revit holds."
      >
        changed in Revit
      </FactChip>
      <ActionButton
        label="read again (r)"
        busy={busy}
        disabled={disabled}
        reason={`Read ${what} from Revit again — proposals and staged cells stay.`}
        onClick={onReadAgain}
      />
    </>
  );
}
