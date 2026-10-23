import { Switcher } from "@pe/kit/lang/switcher";
import { MODE_HINT, MODES, type Mode } from "#/workbench/depth";

/** Pane views retain URL-owned depth and every choice's explanation. */
export function ModeDial({
  mode,
  setMode,
  count,
}: {
  mode: Mode;
  setMode: (mode: Mode) => void;
  count?: number | string;
}) {
  return (
    <Switcher
      ariaLabel="View depth"
      value={mode}
      onChange={setMode}
      options={MODES.map((value) => ({
        value,
        label: (
          <>
            <span>{value}</span>
            {value === "threads" && count != null ? <small>{count}</small> : null}
          </>
        ),
        title: MODE_HINT[value],
      }))}
    />
  );
}
