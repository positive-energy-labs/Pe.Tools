// THROWAWAY — /runs feedback-loop round 1 (proto). Shared bits the three variants compose:
// the export verb strip (all three verbs REAL), flag chips, the one-line note input, and the
// post-export status block that proves what happened (dir, paths, clipboard payload).
import { cn } from "#/lib/utils";

import { runExport } from "./export";
import { fb, flagLabel, type StagedItem, useFb } from "./staging";

export function ExportVerbs(props: { items: StagedItem[]; pool: string | null; compact?: boolean }) {
  const { exporting } = useFb();
  const disabled = props.items.length === 0 || exporting !== null;
  const btn = (
    verb: "chat" | "sheet" | "snip",
    label: string,
    title: string,
    primary = false,
  ) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void runExport(verb, props.items, props.pool)}
      title={title}
      className={cn(
        "tele border px-2 py-0.5 text-[11px] disabled:opacity-40",
        primary
          ? "border-transparent bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      style={{ borderColor: primary ? undefined : "var(--line-2)", borderRadius: 2 }}
    >
      {exporting === verb ? "…" : label}
    </button>
  );
  return (
    <div className={cn("flex items-center gap-1.5", props.compact && "gap-1")}>
      {btn(
        "chat",
        "copy for chat",
        "Write per-item PNGs + manifest to the pool's _exports/, then copy a compact text block (ids, flags, notes, absolute PNG paths) — paste it into an agent TUI; agents read the PNGs from the paths.",
        true,
      )}
      {btn(
        "sheet",
        "copy sheet png",
        "Stitch every staged item into one contact-sheet PNG and put it on the clipboard as an image (for GUI chats). Files are written to _exports/ too.",
      )}
      {btn(
        "snip",
        "save + snip",
        "Write the export, then open the first PNG in Windows Snipping Tool for freehand annotation.",
      )}
    </div>
  );
}

export function ExportStatus(props: { className?: string }) {
  const { exporting, lastExport, exportError } = useFb();
  if (exporting) {
    return (
      <div className={cn("tele text-[10px] text-muted-foreground", props.className)}>
        compositing + writing export…
      </div>
    );
  }
  if (exportError) {
    return (
      <div className={cn("tele text-[10px]", props.className)} style={{ color: "var(--r-alarm)" }}>
        export failed: {exportError}
      </div>
    );
  }
  if (!lastExport) return null;
  return (
    <div className={cn("tele flex flex-col gap-0.5 text-[10px] text-muted-foreground", props.className)}>
      <span className="break-all">
        wrote {lastExport.files.length} file{lastExport.files.length === 1 ? "" : "s"} →{" "}
        <span className="text-foreground">{lastExport.dir}</span>
      </span>
      <span>
        {lastExport.verb === "chat" && !lastExport.warning && "text block on clipboard — paste into the agent TUI"}
        {lastExport.verb === "sheet" && !lastExport.warning && "contact-sheet PNG on clipboard — paste into a GUI chat"}
        {lastExport.verb === "snip" && `opened in Snipping Tool: ${lastExport.opened ?? "?"}`}
      </span>
      {lastExport.warning && (
        <span style={{ color: "var(--r-alarm)" }}>{lastExport.warning}</span>
      )}
      {lastExport.text && (
        <details>
          <summary className="cursor-pointer">view the copied text block</summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border p-1.5" style={{ borderColor: "var(--line-2)", borderRadius: 2 }}>
            {lastExport.text}
          </pre>
        </details>
      )}
    </div>
  );
}

/** The staged item's flags as removable alarm chips. A flag is DATA — the element id shows. */
export function FlagChips(props: { item: StagedItem }) {
  if (props.item.flags.length === 0) {
    return <span className="tele text-[10px] text-muted-foreground/60">no flags — click rooms/residues on the staged panel</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {props.item.flags.map((el) => (
        <button
          key={el}
          type="button"
          onClick={() => fb.toggleFlag(props.item.key, el)}
          title={`Flagged element ${flagLabel(el)} — goes into the manifest as data. Click to unflag.`}
          className="tele border px-1 text-[10px]"
          style={{ borderColor: "var(--r-alarm)", color: "var(--r-alarm)", borderRadius: 2 }}
        >
          ⚑ {flagLabel(el)} ✕
        </button>
      ))}
    </span>
  );
}

export function NoteInput(props: { item: StagedItem; className?: string; autoFocus?: boolean }) {
  return (
    <input
      value={props.item.note}
      onChange={(e) => fb.setNote(props.item.key, e.target.value)}
      placeholder='note — verdict-shaped, e.g. "top wall of the thin room is bad"'
      title="One free-text note for this staged item (TASTE.md verdict shape). Lands in the manifest, the caption strip, and the clipboard text."
      autoFocus={props.autoFocus}
      className={cn(
        "tele w-full border bg-background px-1.5 py-0.5 text-[11px] placeholder:text-muted-foreground/50",
        props.className,
      )}
      style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
    />
  );
}

export const zoneShort = (name: string) => (name.includes("#") ? `#${name.split("#")[1]}` : name);
export const runShort = (id: string | null) => (id ? id.slice(9, 15) : "—");
