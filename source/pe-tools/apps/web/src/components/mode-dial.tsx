import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { MODE_HINT, MODES, type Mode } from "#/workbench/depth";

/** Segmented chat/trace/world depth dial. Mode lives in the URL (useMode wraps the search param). */
export function ModeDial({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return (
    <ToggleGroup
      aria-label="View depth"
      title={MODE_HINT[mode]}
      value={mode}
      onValueChange={(value) => setMode(value as Mode)}
    >
      {MODES.map((value) => (
        <ToggleGroupItem key={value} value={value} className="tele-label">
          {value}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
