import { Switcher } from "#/components/lang/switcher";
import { MODE_HINT, MODES, type Mode } from "#/workbench/depth";

/** Segmented threads/trace/world depth dial. Mode lives in the URL (useMode wraps the search
 * param). A mode is a place you are standing, so the active choice is the selection FILL —
 * the lang Switcher — never a hue; each option carries its consequence as a required title. */
export function ModeDial({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return (
    <Switcher
      ariaLabel="View depth"
      value={mode}
      onChange={setMode}
      options={MODES.map((value) => ({ value, label: value, title: MODE_HINT[value] }))}
    />
  );
}
