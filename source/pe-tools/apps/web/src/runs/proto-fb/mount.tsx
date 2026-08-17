// THROWAWAY — /runs feedback-loop round 1. The one seam browser.tsx touches: a stage button
// for the card header, a flag hook for ZonePanel, and two mount points (above the ledger, at
// the page root). Everything is inert when no ?fb= variant is active — the promoted surface
// behaves exactly as shipped.
import type { ZoneRecord } from "../world";
import { Deck, DeckChip, type PanelComponent } from "./deck";
import { LedgerStrip } from "./ledger-strip";
import { fb, itemKey, useFb } from "./staging";
import { FbSwitcher } from "./switcher";
import { Tray } from "./tray";

export { itemKey };
export type { PanelComponent };

/** ZonePanel's flag seam: null when feedback is off or the card is not staged, else the
 * flag set + toggle for that staged item. */
export function useFbPanel(
  fbKey?: string,
): { flags: Set<string>; toggle: (el: string) => void } | null {
  const { variant, items } = useFb();
  if (!variant || !fbKey) return null;
  const item = items.find((i) => i.key === fbKey);
  if (!item) return null;
  return { flags: new Set(item.flags), toggle: (el: string) => fb.toggleFlag(fbKey, el) };
}

/** The card-header stage toggle. Renders nothing when feedback is off. */
export function FbStageButton(props: {
  name: string;
  runA: string | null;
  runB: string;
  a: ZoneRecord | null;
  b: ZoneRecord | null;
}) {
  const { variant, items } = useFb();
  if (!variant) return null;
  const key = itemKey(props.name, props.runA, props.runB);
  const staged = items.some((i) => i.key === key);
  return (
    <button
      type="button"
      onClick={() =>
        fb.toggleStage({
          key,
          zone: props.name,
          level: (props.b ?? props.a)?.Level ?? "?",
          runA: props.runA,
          runB: props.runB,
          a: props.a,
          b: props.b,
        })
      }
      title={
        staged
          ? "Staged for export — click to unstage. Click rooms/residues on the panel to flag them."
          : "Stage this zone's A/B for the feedback export."
      }
      className="tele shrink-0 border px-1.5 text-[10px]"
      style={{
        borderRadius: 2,
        borderColor: staged ? "var(--r-alarm)" : "var(--line-2)",
        color: staged ? "var(--r-alarm)" : "var(--st-meta)",
      }}
    >
      {staged ? "staged ✓" : "＋ stage"}
    </button>
  );
}

/** Mounts just above the ledger dock — only the fb=ledger variant uses this slot. */
export function FbAboveLedger(props: { pool: string | null }) {
  const { variant } = useFb();
  if (variant !== "ledger") return null;
  return <LedgerStrip pool={props.pool} />;
}

/** Mounts at the page root: the switcher (always in dev) plus the active variant's chrome. */
export function FbRoot(props: {
  pool: string | null;
  ZonePanel: PanelComponent;
  underlay: boolean;
}) {
  const { variant } = useFb();
  return (
    <>
      {variant === "tray" && <Tray pool={props.pool} />}
      {variant === "deck" && (
        <>
          <DeckChip />
          <Deck pool={props.pool} ZonePanel={props.ZonePanel} underlay={props.underlay} />
        </>
      )}
      <FbSwitcher />
    </>
  );
}
