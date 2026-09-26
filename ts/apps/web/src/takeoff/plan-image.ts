/**
 * THE LEVEL'S PLAN IMAGE: the one reader of a level's view image on /takeoffs. The host answers
 * `revit.context.view-image` with a registration (Revit's frame, never re-derived here) and an
 * `imageUrl` that is non-null exactly when the registration is; without one it names why.
 */
import type { RevitContextViewImage, TakeoffsCandidates } from "@pe/host-contracts/generated";
import type { TargetResolution } from "@pe/agent-contracts";

import { hostUrl } from "#/host/client";
import { readOwnerCrops } from "#/takeoff/host";
import { HOST_QUERY_KEY, useHostCall, useHostOp } from "#/readings";
import type { TakeoffPlanImage } from "#/takeoff/level-plan";

type Response = RevitContextViewImage.Res.Response;
export type PlanRefusal = NonNullable<Response["registrationRefusal"]>;

/** Each refusal said as the person reads it, by the contract's own name. */
export const PLAN_REFUSAL: Record<PlanRefusal, string> = {
  NoCrop: "the view has no active crop, so its image has no place in the model",
  NoImage: "Revit exported no image for the view",
  DegenerateCrop: "the view's crop box has no area",
  AspectDisagrees: "the exported image's shape disagrees with the crop, so it is not the crop",
  CropOutsideImage:
    "the view's crop falls outside its exported image, so the image does not hold it",
};

/** A registration corner is model XY in feet; anything else is not a corner. */
const corner = (point: number[]): [number, number] => {
  if (point.length !== 2 || !point.every(Number.isFinite))
    throw Error(`view-image registration corner is not model XY: [${point.join(", ")}]`);
  return [point[0]!, point[1]!];
};

/** The drawable plan, or the host's stated reason there is none. */
function planOf(response: Response): { plan: TakeoffPlanImage } | { refusal: PlanRefusal } {
  const registration = response.registration;
  if (registration && response.imageUrl)
    return {
      plan: {
        href: hostUrl(response.imageUrl),
        registration: {
          ...registration,
          topLeft: corner(registration.topLeft),
          topRight: corner(registration.topRight),
          bottomLeft: corner(registration.bottomLeft),
        },
      },
    };
  if (response.registration || response.imageUrl)
    throw Error(
      "view-image carried an image URL and a registration apart; the contract pairs them",
    );
  if (!response.registrationRefusal)
    throw Error("view-image carried no registration and no refusal naming why");
  return { refusal: response.registrationRefusal };
}

export type OwnerCrop = NonNullable<TakeoffsCandidates.Res.TakeoffRegionFacts["ownerCrop"]>;
/** A drawn zone as the plan picks its image: its owner view, name, and `ownerCrop` (undefined: unread). */
export type DrawnZone = { view: string; name: string; ownerCrop: OwnerCrop | null | undefined };

/**
 * The view whose plan image the Atlas draws for `level`, or the note that says why there is none.
 * Drawn zones pick it: their one owner view (`zone.lane.view`, 31). A zone `Outside` its own view's
 * crop is named and no image is drawn (31b); several owners draw none either, since `ownerCrop`
 * measures a zone against its own view only. With no zones drawn, a chosen view on that level, in
 * the person's order; a level label never picks the view (23).
 */
export const planView = (
  lanes: readonly { view: string; label: string }[],
  views: readonly string[],
  level: string,
  zones: readonly DrawnZone[],
): { view?: string; note?: string } => {
  if (zones.some((zone) => zone.ownerCrop === undefined)) return {};
  // ponytail: one Outside zone withholds the image for the level; draw it under the others only if asked.
  const outside = zones.filter((zone) => zone.ownerCrop === "Outside").map((zone) => zone.name);
  if (outside.length === 1) return { note: `zone ${outside[0]} lies outside its view's crop` };
  if (outside.length > 1)
    return {
      note: `zones ${outside.join(", ")} lie outside their views' crops`,
    };
  const owners = [...new Set(zones.map((zone) => zone.view))];
  if (owners.length === 1) return { view: owners[0] };
  if (owners.length > 1)
    return {
      note: `zones here belong to ${owners.length} views (${owners.join(", ")}); no one view's image is known to hold them all`,
    };
  const view = views.find((view) =>
    lanes.some((lane) => lane.view === view && lane.label === level),
  );
  return view ? { view } : {};
};

/** Each region's `ownerCrop`, by `view:elementId`, read from `takeoffs.candidates` on its owner views. */
export function useOwnerCrops(resolution: TargetResolution, views: readonly string[]) {
  const document =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : undefined;
  const owners = [...new Set(views)].sort();
  const call = useHostCall(
    () => readOwnerCrops(document!, owners),
    [...HOST_QUERY_KEY, "owner-crops", document?.session ?? "", document?.openId ?? "", ...owners],
    Boolean(document && owners.length),
  );
  return { crops: call.data ?? null, error: call.error?.message ?? null };
}

/** Each level once, in lane order: a lane is a view, and many views share a level (29). */
export const levelsOf = (lanes: readonly { label: string }[]): string[] => [
  ...new Set(lanes.map((lane) => lane.label)),
];

/** `pixelSize`: the exported image's long side; absent, the host's default. */
export function usePlanImage(
  resolution: TargetResolution,
  view: string | undefined,
  pixelSize?: number,
) {
  const document =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : undefined;
  const call = useHostOp(
    "revit.context.view-image",
    { target: { name: view ?? "" }, ...(pixelSize ? { pixelSize } : {}) },
    {
      bridgeSessionId: document?.session,
      openDocumentId: document?.openId,
      enabled: Boolean(document && view),
    },
  );
  return {
    image: call.data ? planOf(call.data) : null,
    error: call.error?.message ?? null,
  };
}
