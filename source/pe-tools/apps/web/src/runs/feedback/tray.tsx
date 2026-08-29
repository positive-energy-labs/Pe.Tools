import { token } from "#/lib/token";

import { fb, type StagedItem, useFb } from "./staging";
import { ExportStatus, ExportVerbs, FlagChips, NoteInput, runShort, zoneShort } from "./verbs";
import { Press } from "#/components/lang/press";

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
      style={{ borderColor: token("line-2") }}
    >
      <div className="flex items-baseline gap-2">
        <Press
          type="button"
          onClick={() => props.onSwing(item)}
          title={
            onLens
              ? "This item's pinned A/B pair IS the current lens."
              : "Pinned pair differs from the current lens — click to swing the lens to this item's pair (staging is untouched; the lens is a view)."
          }
        >
          <span className="face-mono t-value font-semibold" title={item.zone}>
            {zoneShort(item.zone)}
          </span>
          <span
            className="face-mono truncate t-caption text-ink-2"
            title={`pinned A=${item.runA ?? "(none)"} B=${item.runB}`}
          >
            {item.level.replace(" Level", "")} · A {runShort(item.runA)} → B {runShort(item.runB)}
          </span>
          {!onLens && (
            <span
              className="face-mono shrink-0 t-caption"
              style={{ color: token("caution") }}
              title="Pinned pair ≠ current lens. The stage keeps the pair it was staged from; click to view it."
            >
              ≠ lens
            </span>
          )}
        </Press>
        <Press
          type="button"
          onClick={() => fb.unstage(item.key)}
          title="Remove this item from the staged set."
          tone="quiet"
          size="mono-caption"
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
    <div className="flex size-full min-h-0 flex-col bg-page">
      <div
        className="flex h-8 shrink-0 items-center gap-2 border-b px-2"
        style={{ borderColor: token("line-2") }}
      >
        <span className="face-mono t-caption t-upper text-ink-2">staging</span>
        <span className="face-mono t-label text-ink-2">
          {items.length === 0 ? "empty" : `${items.length} staged`}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {items.length > 0 && (
            <Press
              type="button"
              onClick={props.onToggleReview}
              title={
                props.review
                  ? "Back to the normal sheet — every zone, two columns."
                  : "Review the staged set: the sheet switches to single-column (bigger images), staged items only, each at its pinned A/B pair. Same cards, bigger layout."
              }
              size="chip-caption"
              tone={props.review ? "neutral" : "bordered-quiet"}
              state={props.review ? "highlighted" : "rest"}
              style={props.review ? undefined : { borderColor: token("line-2") }}
            >
              {props.review ? "✕ exit review" : "review staged"}
            </Press>
          )}
          {items.length > 0 && (
            <Press
              type="button"
              onClick={() => fb.clear()}
              title="Unstage everything."
              tone="quiet"
              size="mono-caption"
            >
              clear
            </Press>
          )}
        </span>
      </div>
      {loadedSet && (
        <div
          className="face-mono shrink-0 truncate border-b px-2 py-1 t-caption text-ink-2"
          style={{ borderColor: token("line-2") }}
          title="This staging was rehydrated from an export manifest — it is editable; exporting mints a NEW stamp, the loaded set is never overwritten."
        >
          loaded from set {loadedSet}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="face-mono px-2 py-3 t-label text-ink-2">
            Nothing staged. Hit <span className="text-ink">＋ stage</span> on a zone card to pin its
            current A/B pair here; click rooms/residues on the staged B panel to flag them. Export
            writes PNGs + manifest.json + clip.txt and puts the block on the clipboard.
          </p>
        ) : (
          items.map((item) => (
            <TrayRow key={item.key} item={item} lens={props.lens} onSwing={props.onSwing} />
          ))
        )}
      </div>
      <div
        className="flex flex-col gap-1.5 border-t px-2 py-2"
        style={{ borderColor: token("line-2") }}
      >
        <ExportVerbs items={items} pool={props.pool} />
        <ExportStatus />
      </div>
    </div>
  );
}

export function TrayCollapsed(props: { count: number; onExpand: () => void }) {
  return (
    <div className="flex size-full flex-col items-center gap-2 bg-page pt-2 hover:bg-recess">
      <Press type="button" onClick={props.onExpand} title="Expand the staging tray.">
        <span className="face-mono t-label text-ink-2">▸</span>
        <span
          className="face-mono t-caption t-upper text-ink-2"
          style={{ writingMode: "vertical-rl" }}
        >
          staging{props.count > 0 ? ` · ${props.count}` : ""}
        </span>
      </Press>
    </div>
  );
}
