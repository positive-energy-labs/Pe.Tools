import { PaneTabs } from "@pe/kit/lang/pane-tabs";
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
    <PaneTabs
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
