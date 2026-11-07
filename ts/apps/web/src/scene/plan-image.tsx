import type {Point2,AffineFrame} from "../lib/affine-frame";
/** Revit's plan export: pixel size and where three corners sit in model feet. */
type PlanRegistration = {
  imageSha256?: string;
  width: number;
  height: number;
  topLeft: [number, number];
  topRight: [number, number];
  bottomLeft: [number, number];
};

function planCanvasTransform(
  plan: PlanRegistration,
  vp: { minX: number; maxY: number; pxPerFt: number },
): [number, number, number, number, number, number] {
  return [
    ((plan.topRight[0] - plan.topLeft[0]) * vp.pxPerFt) / plan.width,
    (-(plan.topRight[1] - plan.topLeft[1]) * vp.pxPerFt) / plan.width,
    ((plan.bottomLeft[0] - plan.topLeft[0]) * vp.pxPerFt) / plan.height,
    (-(plan.bottomLeft[1] - plan.topLeft[1]) * vp.pxPerFt) / plan.height,
    (plan.topLeft[0] - vp.minX) * vp.pxPerFt,
    (vp.maxY - plan.topLeft[1]) * vp.pxPerFt,
  ];
}

/** A level's plan image and where Revit says its pixels sit in the model. */
export interface TakeoffPlanImage {
  href: string;
  registration: PlanRegistration;
}

/** Model feet at the registered image's four corners, including a rotated crop. */
export const planCorners = (plan: TakeoffPlanImage): Point2[] => {
  const { topLeft: a, topRight: b, bottomLeft: c } = plan.registration;
  return [a, b, c, [b[0] + c[0] - a[0], b[1] + c[1] - a[1]]];
};

/**
 * The plan frame as the registration's viewport. `fitFrame` maps model (x, y) to
 * (tx + s·x, ty − s·y), which is `toPx` with pxPerFt = s, minX = −tx/s, maxY = ty/s: the SVG's
 * own frame, handed to `planCanvasTransform` unchanged. Revit's registration stays the authority.
 */
function planViewport(frame: AffineFrame) {
  const [tx, ty] = frame.toViewport([0, 0]);
  return { minX: -tx / frame.scale, maxY: ty / frame.scale, pxPerFt: frame.scale };
}

/** The one plan image layer, under the zones, in the zones' coordinate frame. */
export function PlanImageLayer({ plan, frame }: { plan: TakeoffPlanImage; frame: AffineFrame }) {
  const { registration } = plan;
  return (
    <image
      data-layer="plan-image"
      href={plan.href}
      width={registration.width}
      height={registration.height}
      transform={`matrix(${planCanvasTransform(registration, planViewport(frame)).join(",")})`}
      preserveAspectRatio="none"
      pointerEvents="none"
    />
  );
}

