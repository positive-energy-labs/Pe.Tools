import { token } from "#/lib/token";

import { fb, type StagedItem, useFb } from "./staging";
import { ExportStatus, ExportActions, FlagChips, NoteInput, runShort, zoneShort } from "./verbs";
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";

export type Lens = { curId: string | null; prevId: string | null };

function pinMatchesLens(item: StagedItem, lens: Lens): boolean {
  return item.runB === lens.curId && item.runA === lens.prevId;
}

function TrayRow(props: { item: StagedItem; lens: Lens; onSwing: (item: StagedItem) => void }) {
  const { item, lens } = props;
  const onLens = pinMatchesLens(item, lens);
  return (
    <div className="flex flex-col gap-1 px-2 py-1.5" style={{ borderColor: token("line-2") }}>
      <div className="flex items-baseline gap-2">
        <Press
          type="button"
          tone="quiet"
          onClick={() => props.onSwing(item)}
          title={
            onLens
              ? "This item's pinned A/B pair IS the current lens."
              : "Pinned pair differs from the current lens — click to swing the lens to this item's pair (staging is untouched; the lens is a view)."
          }
        >
          <PressContent geometry="baseline">
            <span className="" title={item.zone}>
              {zoneShort(item.zone)}
            </span>
            <span className="truncate" title={`pinned A=${item.runA ?? "(none)"} B=${item.runB}`}>
              {item.level.replace(" Level", "")} · A {runShort(item.runA)} → B {runShort(item.runB)}
            </span>
            {!onLens && (
              <span
                className="shrink-0"
                style={{ color: token("caution") }}
                title="Pinned pair ≠ current lens. The stage keeps the pair it was staged from; click to view it."
              >
                ≠ lens
              </span>
            )}
          </PressContent>
        </Press>
        <Press
          type="button"
          tone="quiet"
          size="icon"
          onClick={() => fb.unstage(item.key)}
          title="Remove this item from the staged set."
        >
          ✕
        </Press>
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
    <div className="flex size-full min-h-0 flex-col">
      <div
        className="flex h-8 shrink-0 items-center gap-2 px-2"
        style={{ borderColor: token("line-2") }}
      >
        <span className="">staging</span>
        <span className="">{items.length === 0 ? "empty" : `${items.length} staged`}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {items.length > 0 && (
            <Press
              type="button"
              tone="neutral"
              size="caption"
              state={props.review ? "selected" : "rest"}
              onClick={props.onToggleReview}
              title={
                props.review
                  ? "Back to the normal sheet — every zone, two columns."
                  : "Review the staged set: the sheet switches to single-column (bigger images), staged items only, each at its pinned A/B pair. Same cards, bigger layout."
              }
            >
              {props.review ? "✕ exit review" : "review staged"}
            </Press>
          )}
          {items.length > 0 && (
            <Press
              type="button"
              tone="quiet"
              size="caption"
              onClick={() => fb.clear()}
              title="Unstage everything."
            >
              clear
            </Press>
          )}
        </span>
      </div>
      {loadedSet && (
        <div
          className="shrink-0 truncate px-2 py-1"
          style={{ borderColor: token("line-2") }}
          title="This staging was rehydrated from an export manifest — it is editable; exporting mints a NEW stamp, the loaded set is never overwritten."
        >
          loaded from set {loadedSet}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-2 py-3">
            Nothing staged. Hit <span className="">＋ stage</span> on a zone card to pin its current
            A/B pair here; click rooms/residues on the staged B panel to flag them. Export writes
            PNGs + manifest.json + clip.txt and puts the block on the clipboard.
          </p>
        ) : (
          items.map((item) => (
            <TrayRow key={item.key} item={item} lens={props.lens} onSwing={props.onSwing} />
          ))
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-2 py-2" style={{ borderColor: token("line-2") }}>
        <ExportActions items={items} pool={props.pool} />
        <ExportStatus />
      </div>
    </div>
  );
}

export function TrayCollapsed(props: { count: number; onExpand: () => void }) {
  return (
    <Press
      type="button"
      tone="quiet"
      onClick={props.onExpand}
      title="Expand the staging tray."
      style={{ height: "100%" }}
    >
      <PressContent geometry="block">
        <span className="flex h-full flex-col items-center gap-2 pt-2">
          <span className="">▸</span>
          <span className="" style={{ writingMode: "vertical-rl" }}>
            staging{props.count > 0 ? ` · ${props.count}` : ""}
          </span>
        </span>
      </PressContent>
    </Press>
  );
}
