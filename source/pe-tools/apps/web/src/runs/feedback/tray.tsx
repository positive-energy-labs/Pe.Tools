// The staging tray — the winner of feedback round 1 ("TRAY WINS"), promoted from cart-overlay
// chrome to a COLLAPSIBLE RIGHT SIDE PANE of the A/B section (round-2 ruling: not page-height
// chrome; the deck and ledger variants died, the deck's review UX survives as the sheet's
// review-staged MODE, toggled from here).
//
// Lens vs pin: each row shows the pair it PINNED at stage time; a row whose pinned pair is not
// the current lens carries a subtle ≠ mark, and clicking the row swings the lens to its pair
// (the ruling's "clicking a staged card swings the lens to its pair").
import { cn } from "#/lib/utils";

import { fb, type StagedItem, useFb } from "./staging";
import { ExportStatus, ExportVerbs, FlagChips, NoteInput, runShort, zoneShort } from "./verbs";

export type Lens = { curId: string | null; prevId: string | null };

export function pinMatchesLens(item: StagedItem, lens: Lens): boolean {
  return item.runB === lens.curId && item.runA === lens.prevId;
}

function TrayRow(props: { item: StagedItem; lens: Lens; onSwing: (item: StagedItem) => void }) {
  const { item, lens } = props;
  const onLens = pinMatchesLens(item, lens);
  return (
    <div
      className="flex flex-col gap-1 border-b px-2 py-1.5"
      style={{ borderColor: "var(--line-2)" }}
    >
      <div className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={() => props.onSwing(item)}
          title={
            onLens
              ? "This item's pinned A/B pair IS the current lens."
              : "Pinned pair differs from the current lens — click to swing the lens to this item's pair (staging is untouched; the lens is a view)."
          }
          className="flex min-w-0 items-baseline gap-2 text-left"
        >
          <span className="tele text-xs font-semibold" title={item.zone}>
            {zoneShort(item.zone)}
          </span>
          <span
            className="tele truncate text-[10px] text-muted-foreground"
            title={`pinned A=${item.runA ?? "(none)"} B=${item.runB}`}
          >
            {item.level.replace(" Level", "")} · A {runShort(item.runA)} → B {runShort(item.runB)}
          </span>
          {!onLens && (
            <span
              className="tele shrink-0 text-[10px]"
              style={{ color: "var(--st-warn)" }}
              title="Pinned pair ≠ current lens. The stage keeps the pair it was staged from; click to view it."
            >
              ≠ lens
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => fb.unstage(item.key)}
          title="Remove this item from the staged set."
          className="tele ml-auto text-[10px] text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <FlagChips item={item} />
      <NoteInput item={item} multiline />
    </div>
  );
}

export function Tray(props: {
  pool: string | null;
  lens: Lens;
  onSwing: (item: StagedItem) => void;
  review: boolean;
  onToggleReview: () => void;
}) {
  const { items, loadedSet } = useFb();
  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      <div
        className="flex h-8 shrink-0 items-center gap-2 border-b px-2"
        style={{ borderColor: "var(--line-2)" }}
      >
        <span className="tele-label text-muted-foreground">staging</span>
        <span className="tele text-[11px] text-muted-foreground">
          {items.length === 0 ? "empty" : `${items.length} staged`}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {items.length > 0 && (
            <button
              type="button"
              onClick={props.onToggleReview}
              title={
                props.review
                  ? "Back to the normal sheet — every zone, two columns."
                  : "Review the staged set: the sheet switches to single-column (bigger images), staged items only, each at its pinned A/B pair. Same cards, bigger layout."
              }
              className={cn(
                "tele rounded-[2px] px-1.5 py-0.5 text-[10px]",
                props.review
                  ? "bg-secondary text-secondary-foreground"
                  : "border text-muted-foreground hover:text-foreground",
              )}
              style={props.review ? undefined : { borderColor: "var(--line-2)" }}
            >
              {props.review ? "✕ exit review" : "review staged"}
            </button>
          )}
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => fb.clear()}
              title="Unstage everything."
              className="tele text-[10px] text-muted-foreground hover:text-foreground"
            >
              clear
            </button>
          )}
        </span>
      </div>
      {loadedSet && (
        <div
          className="tele shrink-0 truncate border-b px-2 py-1 text-[10px] text-muted-foreground"
          style={{ borderColor: "var(--line-2)" }}
          title="This staging was rehydrated from an export manifest — it is editable; exporting mints a NEW stamp, the loaded set is never overwritten."
        >
          loaded from set {loadedSet}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="tele px-2 py-3 text-[11px] leading-relaxed text-muted-foreground">
            Nothing staged. Hit <span className="text-foreground">＋ stage</span> on a zone card to
            pin its current A/B pair here; click rooms/residues on the staged B panel to flag them.
            Export writes PNGs + manifest.json + clip.txt and puts the block on the clipboard.
          </p>
        ) : (
          items.map((item) => (
            <TrayRow key={item.key} item={item} lens={props.lens} onSwing={props.onSwing} />
          ))
        )}
      </div>
      <div
        className="flex flex-col gap-1.5 border-t px-2 py-2"
        style={{ borderColor: "var(--line-2)" }}
      >
        <ExportVerbs items={items} pool={props.pool} />
        <ExportStatus />
      </div>
    </div>
  );
}

/** The collapsed tray face — a slim vertical strip; the re-expand affordance lives IN the
 * pane (pane collapse law). */
export function TrayCollapsed(props: { count: number; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onExpand}
      title="Expand the staging tray."
      className="flex size-full flex-col items-center gap-2 bg-background pt-2 hover:bg-muted"
    >
      <span className="tele text-[11px] text-muted-foreground">▸</span>
      <span className="tele-label text-muted-foreground" style={{ writingMode: "vertical-rl" }}>
        staging{props.count > 0 ? ` · ${props.count}` : ""}
      </span>
    </button>
  );
}
