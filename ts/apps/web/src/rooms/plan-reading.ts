import type { RevitContextViewImage } from "@pe/host-contracts/generated";
import type { TakeoffPlanImage } from "../takeoff/level-plan";
import type { PlanRefusal } from "../takeoff/plan";
export type PlanReading = {plan:TakeoffPlanImage}|{refusal:PlanRefusal}|null;
/** The image and registration are a pair; malformed native frames never draw plausible geometry. */
export function planOf(response: RevitContextViewImage.Res.Response): Exclude<PlanReading, null> {
  if (response.registration && response.imageUrl) {
    const corner = (p: number[]): [number, number] => {
      if (p.length !== 2 || !p.every(Number.isFinite))
        throw Error(`view-image registration corner is not model XY: [${p.join(", ")}]`);
      return [p[0]!, p[1]!];
    };
    return {
      plan: {
        href: response.imageUrl,
        registration: {
          ...response.registration,
          topLeft: corner(response.registration.topLeft),
          topRight: corner(response.registration.topRight),
          bottomLeft: corner(response.registration.bottomLeft),
        },
      },
    };
  }
  if (response.registration || response.imageUrl)
    throw Error(
      "view-image carried an image URL and a registration apart; the contract pairs them",
    );
  if (!response.registrationRefusal)
    throw Error("view-image carried no registration and no refusal naming why");
  return { refusal: response.registrationRefusal };
}

