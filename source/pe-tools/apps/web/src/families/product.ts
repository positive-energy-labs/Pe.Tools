import { product, type Feeds } from "#/targeting/model";
import { worldTrunk } from "#/targeting/world";

export const FAMILIES_SLOTS = {
  world: worldTrunk.link,
  profile: {
    key: "profile",
    under: null,
    joiner: "against",
    placeholder: "a family profile",
    multi: false,
    needs: "a readable Family Foundry profile",
    dir: "read",
    liveness: "detached",
  },
  scope: {
    key: "scope",
    under: null,
    joiner: "",
    placeholder: "scope",
    multi: false,
    needs: "a draft scope",
    dir: null,
    liveness: null,
  },
  category: {
    key: "category",
    under: "scope",
    joiner: "on",
    placeholder: "categories",
    multi: true,
    needs: "one or more loaded family categories",
    dir: "read",
    liveness: "detached",
  },
  family: {
    key: "family",
    under: "scope",
    joiner: "and",
    placeholder: "families",
    multi: true,
    needs: "one or more loaded families from the draft categories",
    dir: "read",
    liveness: "detached",
  },
} as const;

export type FamiliesSlot = keyof typeof FAMILIES_SLOTS;

type FamiliesProductActions = {
  applyScope: () => Promise<string | void>;
  plan: () => Promise<string | void>;
  apply: () => Promise<string | void>;
  refusePlan: () => string | null;
  refuseApply: () => string | null;
};

export const FAMILIES_PRODUCT = (feeds: Feeds<FamiliesSlot>, actions: FamiliesProductActions) =>
  product(
    "families",
    "families",
    FAMILIES_SLOTS,
  )({
    feeds,
    stages: [
      {
        key: "scope",
        label: "scope",
        verbs: [
          {
            key: "apply-scope",
            label: "apply scope",
            demands: ["category", "family"],
            kind: "act",
            run: actions.applyScope,
            refuse: () => null,
            needs: "a category and family scope",
          },
        ],
      },
      {
        key: "foundry",
        label: "foundry",
        verbs: [
          {
            key: "plan",
            label: "plan",
            demands: ["world", "profile", "category", "family"],
            kind: "act",
            run: actions.plan,
            refuse: actions.refusePlan,
            needs: "an applied scope and family profile",
          },
          {
            key: "apply",
            label: "apply",
            demands: ["world", "profile", "category", "family"],
            kind: "commit",
            run: actions.apply,
            refuse: actions.refuseApply,
            needs: "a current foundry plan",
          },
        ],
      },
    ],
    panes: [{ key: "matrix", label: "matrix", draws: ["category", "family"] }],
  });
