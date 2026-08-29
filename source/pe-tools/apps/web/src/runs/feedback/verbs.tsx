import { token } from "#/lib/token";
import type { ChangeEvent } from "react";

import { cn } from "#/lib/utils";

import { runExport } from "./export";
import { fb, flagLabel, type StagedItem, useFb } from "./staging";
import { Press } from "#/components/lang/press";
import { Verb } from "#/components/lang/verb";

export function ExportVerbs(props: {
  items: StagedItem[];
  pool: string | null;
  compact?: boolean;
}) {
  const { exporting } = useFb();
  const disabled = props.items.length === 0 || exporting !== null;
  const refusal =
    props.items.length === 0
      ? "Nothing is staged yet — stage at least one item first. "
      : exporting !== null
        ? "An export is already running. "
        : "";
  const btn = (verb: "chat" | "sheet" | "snip", label: string, does: string, primary = false) => (
    <Verb
      label={label}
      reason={refusal + does}
      tone={primary ? "commit" : "act"}
      disabled={disabled}
      busy={exporting === verb}
      onClick={() => void runExport(verb, props.items, props.pool)}
    />
  );
  return (
    <div className={cn("flex items-center gap-1.5", props.compact && "gap-1")}>
      {btn(
        "chat",
        "copy for chat",
        "Write per-item PNGs + manifest.json + clip.txt to the pool's _exports/, then copy the compact text block (ids, flags, notes, absolute PNG paths, the set's ?set= URL) via the OS clipboard — paste it into an agent TUI; agents read the PNGs from the paths.",
        true,
      )}
      {btn(
        "sheet",
        "copy sheet png",
        "Stitch every staged item into one contact-sheet PNG and put it on the OS clipboard as an image (for GUI chats). Files + clip.txt are written to _exports/ too.",
      )}
      {btn(
        "snip",
        "save + snip",
        "Write the export (files + manifest + clip.txt), then open the first PNG in Windows Snipping Tool for freehand annotation.",
      )}
    </div>
  );
}

export function ExportStatus(props: { className?: string }) {
  const { exporting, lastExport, exportError } = useFb();
  if (exporting) {
    return (
      <div className={cn("face-mono t-caption text-ink-2", props.className)}>
        compositing + writing export…
      </div>
    );
  }
  if (exportError) {
    return (
      <div className={cn("face-mono t-caption", props.className)} style={{ color: token("alarm") }}>
        export failed: {exportError}
      </div>
    );
  }
  if (!lastExport) return null;
  return (
    <div className={cn("face-mono flex flex-col gap-0.5 t-caption text-ink-2", props.className)}>
      <span className="break-all">
        wrote {lastExport.files.length} file{lastExport.files.length === 1 ? "" : "s"} + clip.txt →{" "}
        <span className="text-ink">{lastExport.dir}</span>
      </span>
      <span>
        {lastExport.verb === "chat" &&
          lastExport.copiedVia &&
          "text block on clipboard — paste into the agent TUI"}
        {lastExport.verb === "sheet" &&
          lastExport.copiedVia &&
          "contact-sheet PNG on clipboard — paste into a GUI chat"}
        {lastExport.verb === "snip" && `opened in Snipping Tool: ${lastExport.opened ?? "?"}`}
        {lastExport.copiedVia === "browser" && " (browser fallback)"}
      </span>
      <a
        href={`/runs?set=${lastExport.stamp}`}
        title="This export's rehydration link — open it (or paste it) to reload this staged set, editable. Re-exporting mints a new stamp."
        className="break-all underline decoration-dotted hover:text-ink"
      >
        ?set={lastExport.stamp}
      </a>
      {lastExport.warning && <span style={{ color: token("alarm") }}>{lastExport.warning}</span>}
      <details>
        <summary className="cursor-pointer">view the clip block</summary>
        <pre
          className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border p-1.5"
          style={{ borderColor: token("line-2"), borderRadius: "var(--radius)" }}
        >
          {lastExport.text}
        </pre>
      </details>
    </div>
  );
}

export function FlagChips(props: { item: StagedItem }) {
  if (props.item.flags.length === 0) {
    return (
      <span className="face-mono t-caption text-ink-2/60">
        no flags — click rooms/residues on the staged B panel
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {props.item.flags.map((el) => (
        <Press
          key={el}
          type="button"
          onClick={() => fb.toggleFlag(props.item.key, el)}
          onMouseEnter={() => fb.setHoverFlag(`${props.item.key}::${el}`)}
          onMouseLeave={() => fb.setHoverFlag(null)}
          title={`Flagged element ${flagLabel(el)} — goes into the manifest as data. Hover to light it on the B panel; click to unflag.`}
          className="face-mono border px-1 t-caption"
          style={{
            borderColor: token("caution"),
            color: token("caution"),
            borderRadius: "var(--radius)",
          }}
        >
          ⚑ {flagLabel(el)} ✕
        </Press>
      ))}
    </span>
  );
}

export function NoteInput(props: {
  item: StagedItem;
  className?: string;
  autoFocus?: boolean;
  multiline?: boolean;
}) {
  const shared = {
    value: props.item.note,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      fb.setNote(props.item.key, e.target.value),
    placeholder: 'note — verdict-shaped, e.g. "top wall of the thin room is bad"',
    title:
      "One free-text note for this staged item (TASTE.md verdict shape). Lands in the manifest, the caption strip, and the clip block.",
    autoFocus: props.autoFocus,
    className: cn(
      "face-mono w-full border bg-page px-1.5 py-0.5 t-label placeholder:text-ink-2/50",
      props.className,
    ),
    style: { borderColor: token("line-2"), borderRadius: "var(--radius)" },
  };
  return props.multiline ? (
    <textarea {...shared} rows={3} className={cn(shared.className, "resize-y")} />
  ) : (
    <input {...shared} />
  );
}

export const zoneShort = (name: string) => (name.includes("#") ? `#${name.split("#")[1]}` : name);
export const runShort = (id: string | null) => (id ? id.slice(9, 15) : "—");
