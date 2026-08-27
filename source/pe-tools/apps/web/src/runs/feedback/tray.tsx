// The staging tray — the winner of feedback round 1 ("TRAY WINS"), promoted from cart-overlay
// chrome to a COLLAPSIBLE RIGHT SIDE PANE of the A/B section (round-2 ruling: not page-height
// chrome; the deck and ledger variants died, the deck's review UX survives as the sheet's
// review-staged MODE, toggled from here).
//
// Lens vs pin: each row shows the pair it PINNED at stage time; a row whose pinned pair is not
// the current lens carries a subtle ≠ mark, and clicking the row swings the lens to its pair
// (the ruling's "clicking a staged card swings the lens to its pair").
import { cn } from "#/lib/utils";
import { Verb } from "#/components/lang/verb";

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
      style={{ borderColor: "var(--r-line-2)" }}
    >
      <div className="flex items-baseline gap-2">
        <Verb
          label={`${zoneShort(item.zone)} · A ${runShort(item.runA)} → B ${runShort(item.runB)}${!onLens ? " ≠ lens" : ""}`}
          reason={
            onLens
              ? "This item's pinned A/B pair IS the current lens."
              : "Pinned pair differs from the current lens — click to swing the lens to this item's pair (staging is untouched; the lens is a view)."
          }
          onClick={() => props.onSwing(item)}
          className="min-w-0 text-left"
        />
        <Verb
          label="✕"
          reason="Remove this item from the staged set."
          onClick={() => fb.unstage(item.key)}
          className="face-mono t-caption ml-auto t-caption text-muted-foreground hover:text-foreground"
        />
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
        style={{ borderColor: "var(--r-line-2)" }}
      >
        <span className="t-label t-upper text-muted-foreground">staging</span>
        <span className="face-mono t-caption t-label text-muted-foreground">
          {items.length === 0 ? "empty" : `${items.length} staged`}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {items.length > 0 && (
            <Verb
              label={props.review ? "✕ exit review" : "review staged"}
              reason={
                props.review
                  ? "Back to the normal sheet — every zone, two columns."
                  : "Review the staged set: the sheet switches to single-column (bigger images), staged items only, each at its pinned A/B pair. Same cards, bigger layout."
              }
              onClick={props.onToggleReview}
              tone={props.review ? "commit" : "act"}
              className={cn(
                "face-mono t-caption rounded-[2px] px-1.5 py-0.5 t-caption",
                props.review
                  ? "bg-secondary text-secondary-foreground"
                  : "border text-muted-foreground hover:text-foreground",
              )}
              style={props.review ? undefined : { borderColor: "var(--r-line-2)" }}
            />
          )}
          {items.length > 0 && (
            <Verb
              label="clear"
              reason="Unstage everything."
              onClick={() => fb.clear()}
              className="face-mono t-caption t-caption text-muted-foreground hover:text-foreground"
            />
          )}
        </span>
      </div>
      {loadedSet && (
        <div
          className="face-mono t-caption shrink-0 truncate border-b px-2 py-1 t-caption text-muted-foreground"
          style={{ borderColor: "var(--r-line-2)" }}
          title="This staging was rehydrated from an export manifest — it is editable; exporting mints a NEW stamp, the loaded set is never overwritten."
        >
          loaded from set {loadedSet}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="face-mono t-caption px-2 py-3 t-label leading-relaxed text-muted-foreground">
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
        style={{ borderColor: "var(--r-line-2)" }}
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
    <Verb
      label={`▸ staging${props.count > 0 ? ` · ${props.count}` : ""}`}
      reason="Expand the staging tray."
      onClick={props.onExpand}
      className="flex size-full flex-col items-center gap-2 bg-background pt-2 hover:bg-muted"
    />
  );
}
