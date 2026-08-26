import { product, type Feeds, type Verb } from "#/targeting/model";
import { worldTrunk } from "#/targeting/world";

export const FAMILY_SLOTS = {
  world: worldTrunk.link,
  profile: {
    key: "profile",
    under: "world",
    joiner: "editing",
    placeholder: "a family profile",
    multi: false,
    needs: "a family document path visible to the bound world",
    dir: "duplex",
    liveness: "detached",
  },
} as const;

export type FamilySlot = keyof typeof FAMILY_SLOTS;
type FamilyAction = Pick<Verb<FamilySlot>, "run" | "refuse">;

export const FAMILY_PRODUCT = (
  feeds: Feeds<FamilySlot>,
  verbs: Record<"open" | "save" | "capture" | "build", FamilyAction>,
) =>
  product(
    "family",
    "family",
    FAMILY_SLOTS,
  )({
    feeds,
    stages: [
      {
        key: "author",
        label: "author",
        verbs: [
          {
            key: "open",
            label: "open",
            demands: ["profile"],
            kind: "act",
            needs: "a family profile",
            ...verbs.open,
          },
          {
            key: "save",
            label: "save profile",
            demands: ["profile"],
            kind: "commit",
            needs: "a family profile",
            ...verbs.save,
          },
        ],
      },
      {
        key: "evidence",
        label: "evidence",
        verbs: [
          {
            key: "capture",
            label: "capture evidence",
            demands: ["world"],
            kind: "act",
            needs: "a live family document",
            ...verbs.capture,
          },
          {
            key: "build",
            label: "build .rfa",
            demands: ["world", "profile"],
            kind: "commit",
            needs: "evidence and a family profile",
            ...verbs.build,
          },
        ],
      },
    ],
    panes: [
      { key: "sheet", label: "sheet", draws: ["profile"] },
      { key: "anatomy", label: "anatomy", draws: ["profile"] },
      { key: "drill", label: "drill", draws: ["world", "profile"] },
      { key: "inspector", label: "inspector", draws: ["profile"] },
    ],
  });
