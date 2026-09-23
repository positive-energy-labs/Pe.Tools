/**
 * One drawing of the host's per-document freshness mark, for every surface that
 * draws a document (design-system ledger, 2026-09-22). The fact is always the host's: a Reading's
 * envelope says a document changed or host observation began after the read. This says so and offers
 * the re-read; it never measures an age and never decides freshness itself.
 */
import { FactChip } from "#/components/lang/chip";
import { ActionButton } from "#/components/lang/action-button";
import { useScopeKeys } from "#/route/keys";

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
  const says = `Read ${what} from Revit again — proposals and staged cells stay.`;
  const refusal = busy ? "A read is running" : disabled ? "Another action is running" : null;
  useScopeKeys([
    {
      hotkey: "R",
      label: "read again",
      says,
      refusal,
      callback: () => {
        if (!refusal) onReadAgain();
      },
    },
  ]);
  return (
    <>
      <FactChip
        tone="caution"
        title="This read is no longer verified against Revit. Reading again updates it from Revit."
      >
        read may be stale
      </FactChip>
      <ActionButton
        label="read again (r)"
        busy={busy}
        disabled={disabled}
        reason={says}
        onClick={onReadAgain}
      />
    </>
  );
}
