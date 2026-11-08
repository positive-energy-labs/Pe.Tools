import type { AffineFrame } from "#/lib/affine-frame";
import type { PlanRefusal } from "./plan-reading";

// CHEAT: keep the small drawing primitives local while the archived takeoff implementation remains.
// Importing its plan/level-plan reaches route/view-bridge -> route/view-owner; Rooms never does.
export const PLAN_REFUSAL: Record<PlanRefusal, string> = {
  NoCrop: "the view has no active crop, so its image has no place in the model",
  NoImage: "Revit exported no image for the view",
  DegenerateCrop: "the view's crop box has no area",
  AspectDisagrees: "the exported image's shape disagrees with the crop, so it is not the crop",
  CropOutsideImage:
    "the view's crop falls outside its exported image, so the image does not hold it",
};

export function pathD(
  loops: readonly (readonly (readonly [number, number])[])[],
  frame: Pick<AffineFrame, "toViewport">,
): string {
  return loops
    .filter((loop) => loop.length >= 3)
    .map(
      (loop) =>
        loop
          .map(([x, y], i) => {
            const [px, py] = frame.toViewport([x, y]);
            return `${i === 0 ? "M" : "L"}${px.toFixed(3)} ${py.toFixed(3)}`;
          })
          .join("") + "Z",
    )
    .join("");
}
