/** One axis's cut controls beside the picture: seed a line or box, close or reopen, offset, reverse, clear. */
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { frameRect } from "#/scene/plane";
import type { Bounds } from "#/scene/types";

import { AXIS_LABEL, emptyCut, seedCut, type Axis, type Cut, type Cuts } from "./state";

export function CutControls({
  axis,
  cuts,
  bounds,
  onCuts,
}: {
  axis: Axis;
  cuts: Cuts;
  bounds: Bounds;
  onCuts: (next: Cuts, how: "push" | "replace") => void;
}) {
  const cut = cuts[axis];
  const set = (next: Cut, how: "push" | "replace" = "push") =>
    onCuts({ ...cuts, [axis]: next }, how);
  const label = AXIS_LABEL[axis];
  if (!cut.polyline.length)
    return (
      <div className="flex flex-wrap items-center gap-1" data-cut-controls={axis}>
        <span className="t-small text-ink-2">No {label} cut: nothing is clipped on this axis.</span>
        <Button
          label={`Add a ${label} section line`}
          onClick={() => set(seedCut(frameRect(axis, bounds), "line"))}
        >
          Add line
        </Button>
        <Button
          label={`Add a ${label} box`}
          onClick={() => set(seedCut(frameRect(axis, bounds), "box"))}
        >
          Add box
        </Button>
      </div>
    );
  const kept = cut.closed
    ? cut.keepInside
      ? "Inside"
      : "Outside"
    : cut.keepInside
      ? "Left side"
      : "Right side";
  return (
    <div className="flex flex-wrap items-center gap-1" data-cut-controls={axis}>
      <span className="t-small text-ink-2">
        {label}: {kept} kept.
      </span>
      <Button
        label={cut.closed ? "Reopen polygon" : "Close polygon"}
        refusal={!cut.closed && cut.polyline.length < 3 ? "Add a third node first" : null}
        onClick={() => set({ ...cut, closed: !cut.closed })}
      >
        {cut.closed ? "Reopen" : "Close"}
      </Button>
      <span className="t-small">offset ft</span>
      <div className="w-16">
        <Input
          type="number"
          aria-label="Cut offset in feet, toward the left of the drawing direction"
          step={0.5}
          value={cut.offset}
          onChange={(e) => {
            const offset = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(offset))
              set({ ...cut, offset }, "replace");
          }}
        />
      </div>
      <Button
        label="Reverse retained side"
        onClick={() => set({ ...cut, keepInside: !cut.keepInside })}
      >
        Reverse
      </Button>
      <Button label={`Clear the ${label} cut`} onClick={() => set(emptyCut)}>
        Clear
      </Button>
    </div>
  );
}
