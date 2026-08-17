// THROWAWAY — /runs feedback-loop round 1, variant fb=tray.
// THESIS: staging lives in a docked TRAY (cart pattern). Stage from cards, flags applied in
// place on the card SVGs, the tray lists the staged set with notes and the export verbs.
// The page stays the page — review never leaves the sheet.
import { fb, type StagedItem, useFb } from "./staging";
import { ExportStatus, ExportVerbs, FlagChips, NoteInput, runShort, zoneShort } from "./verbs";

function TrayRow(props: { item: StagedItem }) {
  const { item } = props;
  return (
    <div className="flex flex-col gap-1 border-b px-2 py-1.5" style={{ borderColor: "var(--line-2)" }}>
      <div className="flex items-baseline gap-2">
        <span className="tele text-xs font-semibold" title={item.zone}>
          {zoneShort(item.zone)}
        </span>
        <span className="tele text-[10px] text-muted-foreground" title={`A=${item.runA ?? "(none)"} B=${item.runB}`}>
          {item.level.replace(" Level", "")} · A {runShort(item.runA)} → B {runShort(item.runB)}
        </span>
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
      <NoteInput item={item} />
    </div>
  );
}

export function Tray(props: { pool: string | null }) {
  const { items } = useFb();
  if (items.length === 0) {
    return (
      <div
        className="tele fixed right-3 top-28 z-40 border bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm"
        style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
      >
        staging tray — empty · hit <span className="text-foreground">stage</span> on a zone card
      </div>
    );
  }
  return (
    <div
      className="fixed bottom-16 right-3 top-28 z-40 flex w-80 flex-col border bg-background shadow-md"
      style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
    >
      <div className="flex items-baseline gap-2 border-b px-2 py-1.5" style={{ borderColor: "var(--line-2)" }}>
        <span className="tele-label text-muted-foreground">staging tray</span>
        <span className="tele text-[11px] text-muted-foreground">{items.length} staged</span>
        <button
          type="button"
          onClick={() => fb.clear()}
          title="Unstage everything."
          className="tele ml-auto text-[10px] text-muted-foreground hover:text-foreground"
        >
          clear
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.map((item) => (
          <TrayRow key={item.key} item={item} />
        ))}
      </div>
      <div className="flex flex-col gap-1.5 border-t px-2 py-2" style={{ borderColor: "var(--line-2)" }}>
        <ExportVerbs items={items} pool={props.pool} />
        <ExportStatus />
      </div>
    </div>
  );
}
