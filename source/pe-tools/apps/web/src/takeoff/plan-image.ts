/**
 * THE LEVEL'S PLAN IMAGE: the one reader of a level's view image on /takeoffs. The host answers
 * `revit.context.view-image` with a registration (Revit's frame, never re-derived here) and an
 * `imageUrl` that is non-null exactly when the registration is; without one it names why.
 */
import type { RevitContextViewImage } from "@pe/host-contracts/generated";
import type { TargetResolution } from "@pe/agent-contracts";

import { hostUrl } from "#/host/client";
import { useHostOp } from "#/readings";
import type { TakeoffPlanImage } from "#/takeoff/level-plan";

type Response = RevitContextViewImage.Res.Response;
export type PlanRefusal = NonNullable<Response["registrationRefusal"]>;

/** Each refusal said as the person reads it, by the contract's own name. */
export const PLAN_REFUSAL: Record<PlanRefusal, string> = {
  NoCrop: "the view has no active crop, so its image has no place in the model",
  NoImage: "Revit exported no image for the view",
  DegenerateCrop: "the view's crop box has no area",
  AspectDisagrees: "the exported image's shape disagrees with the crop, so it is not the crop",
};

/** A registration corner is model XY in feet; anything else is not a corner. */
const corner = (point: number[]): [number, number] => {
  if (point.length !== 2 || !point.every(Number.isFinite))
    throw Error(`view-image registration corner is not model XY: [${point.join(", ")}]`);
  return [point[0]!, point[1]!];
};

/** The drawable plan, or the host's stated reason there is none. */
export function planOf(response: Response): { plan: TakeoffPlanImage } | { refusal: PlanRefusal } {
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

export function usePlanImage(resolution: TargetResolution, view: string | undefined) {
  const document =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : undefined;
  const call = useHostOp(
    "revit.context.view-image",
    { target: { name: view ?? "" } },
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
