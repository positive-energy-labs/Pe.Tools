import { chatStyles } from "#/components/lang/chat-appearance";
import { token } from "#/lib/token";
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";
/**
 * DocPicker rows — the one visual vocabulary for picking a document, shared by every
 * mount (the sentence's doc slot, the .rvt/.rfa chips). The look is the poc/chip-a
 * winner: extension chip + name + mono sub-line, optional year band headers, selected
 * marker. Presentation only — each mount owns its own data wiring and action loop.
 *
 * Colour law (workbench pass): a document KIND is taxonomy, so the extension chip spends
 * the viz ladder (rvt→viz-1, rfa→viz-6 — the old blue/kiln identities carried forward).
 * Selection is the selection FILL, never a hue; hover is the one veil.
 */

const EXT_COLOR: Record<string, string> = {
  rvt: token("viz-1"),
  rfa: token("viz-6"),
};

export function extOf(path: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match?.[1]?.toLowerCase();
}

/** Year/section band header, e.g. "REVIT 2025 · 4". */
export function DocGroup({ label, aside }: { label: string; aside?: string }) {
  return (
    <div className={chatStyles.docPicker0()}>
      <span className={chatStyles.docPicker1()}>{label}</span>
      {aside ? <span className={chatStyles.docPicker2()}>{aside}</span> : null}
    </div>
  );
}

export function DocRow({
  ext,
  label,
  sub,
  subTone = "muted",
  selected,
  disabled,
  onPick,
}: {
  /** Extension chip ("rvt"/"rfa" get their taxonomy hue; anything else renders muted). */
  ext?: string;
  label: string;
  /** Mono sub-line: observed state ("open now"), never a guess. */
  sub?: string;
  subTone?: "muted" | "active";
  selected?: boolean;
  disabled?: boolean;
  onPick: () => void;
}) {
  return (
    <Press
      type="button"
      disabled={disabled}
      onClick={onPick}
      tone="quiet"
      state={selected ? "selected" : "disabled"}
    >
      <PressContent geometry="row">
        {ext ? (
          <span
            className={chatStyles.docPicker3()}
            style={{
              borderColor: EXT_COLOR[ext] ?? token("line-2"),
              color: EXT_COLOR[ext] ?? token("ink-2"),
            }}
          >
            {ext}
          </span>
        ) : null}
        <span className={chatStyles.docPicker4()}>
          <span className={chatStyles.docPicker5()}>{label}</span>
          {sub ? (
            <span
              className={
                subTone === "active" ? chatStyles.docSubActive() : chatStyles.docSubQuiet()
              }
            >
              {sub}
            </span>
          ) : null}
        </span>
        {selected ? <span className={chatStyles.docPicker6()}>◉</span> : null}
      </PressContent>
    </Press>
  );
}
