import type { LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { Kbd } from "./kbd";
import { chordLabel, useScopeKeys, type Chord } from "#/route/keys";
import "./hotkey-command.css";

type Props = Omit<ButtonProps, "children" | "onClick" | "icon" | "kind" | "direction"> & {
  kind?: "quiet" | "framed" | "commit";
  icon?: LucideIcon;
  hotkey: Chord;
  invoke: () => void;
  word?: string;
  bind?: boolean;
  face?: "compact" | "medium" | "full" | "responsive";
};
const KEY_SYMBOLS: Record<string, string> = {
  Ctrl: "M2 8.5 6 3 10 8.5",
  Shift: "M6 1.5 10.5 6H8v4.5H4V6H1.5Z",
  Alt: "M1.5 2.5H4l4 7h2.5M7 2.5h3.5",
  Escape: "M9.5 2.5V7h-7M5 4.5 2.5 7 5 9.5",
};
function KeyMark({ name }: { name: string }) {
  if (name === ".")
    return (
      <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden data-key-symbol="Period">
        <circle cx={6} cy={6} r={1.4} fill="currentColor" />
      </svg>
    );
  const key = name === "Control" ? "Ctrl" : name === "Esc" ? "Escape" : name;
  const path = KEY_SYMBOLS[key];
  return path ? (
    <svg
      viewBox="0 0 12 12"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-key-symbol={key}
    >
      <path d={path} />
    </svg>
  ) : (
    <span data-command-key>{name}</span>
  );
}
function ChordFaces({ hotkey, tone }: { hotkey: Chord; tone?: string }) {
  return (
    <>
      <span data-command-keys aria-hidden>
        <Kbd>
          <span data-command-symbols data-tone={tone}>
            {chordLabel(hotkey)
              .split("+")
              .map((key, index) => (
                <KeyMark key={`${key}-${index}`} name={key} />
              ))}
          </span>
        </Kbd>
      </span>
      <span data-command-chord>
        <Kbd>
          <span data-tone={tone}>{chordLabel(hotkey)}</span>
        </Kbd>
      </span>
    </>
  );
}
/** A noninteractive chord face; the owning control provides activation and key registration. */
export function HotkeyHint({
  hotkey,
  face = "responsive",
}: {
  hotkey: Chord;
  face?: Props["face"];
}) {
  return (
    <span
      className="dl-hotkey-command dl-hotkey-hint"
      data-command-face={face}
      aria-label={chordLabel(hotkey)}
    >
      <ChordFaces hotkey={hotkey} />
    </span>
  );
}
function Face({
  hotkey,
  invoke,
  word,
  face = "responsive",
  bind: _bind,
  icon: Icon,
  "data-tone": tone,
  ...button
}: Props) {
  return (
    <span className="dl-hotkey-command" data-command-face={face}>
      <Button
        {...button}
        icon={Icon ? <Icon strokeWidth={1.75} aria-hidden data-tone={tone} /> : undefined}
        aria-keyshortcuts={chordLabel(hotkey)
          .replace(/Ctrl|⌃/g, "Control")
          .replace(/⌘/g, "Meta+")
          .replace(/⌥/g, "Alt+")
          .replace(/⇧/g, "Shift+")
          .replace(/\s+/g, "")
          .replace(/\+\+/g, "+")}
        reason={`${button.reason ? `${button.reason} · ` : ""}${word ?? button.label} · ${chordLabel(hotkey)}`}
        onClick={invoke}
      >
        <span data-command-word data-tone={tone}>
          {word ?? button.label}
        </span>
        <ChordFaces hotkey={hotkey} tone={tone} />
      </Button>
    </span>
  );
}
function Bound(props: Props) {
  useScopeKeys([
    {
      hotkey: props.hotkey,
      callback: props.invoke,
      label: props.label,
      refusal: props.busy ? "This command is busy" : props.refusal,
      options: { ignoreInputs: false },
    },
  ]);
  return <Face {...props} />;
}
/** One admitted callback for both click and chord; bind=false keeps a caller-owned registration. */
export function HotkeyCommand({ bind = true, invoke, refusal, busy, ...props }: Props) {
  const run = () => {
    if (refusal == null && !busy) invoke();
  };
  return bind ? (
    <Bound {...props} busy={busy} refusal={refusal} invoke={run} />
  ) : (
    <Face {...props} busy={busy} refusal={refusal} invoke={run} />
  );
}
