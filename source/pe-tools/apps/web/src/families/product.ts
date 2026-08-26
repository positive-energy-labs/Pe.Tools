import type { Product } from "#/targeting/model";
import { profileTerminal, worldTrunk } from "#/targeting/trunks";

const profile = profileTerminal("read");

export type FamiliesProductActions = {
  applyScope: () => Promise<string | void>;
  plan: () => Promise<string | void>;
  apply: () => Promise<string | void>;
  refusePlan?: () => string | null;
  refuseApply?: () => string | null;
};

export const FAMILIES_PRODUCT = (actions: FamiliesProductActions): Product => ({
  key: "families",
  name: "families",
  links: [
    worldTrunk.link,
    profile.link,
    {
      key: "scope",
      joiner: "",
      placeholder: "scope",
      needs: "a draft scope",
    },
    {
      key: "category",
      parent: "scope",
      joiner: "on",
      placeholder: "categories",
      needs: "one or more loaded family categories",
      multi: true,
      dir: "read",
      liveness: "detached",
    },
    {
      key: "family",
      parent: "scope",
      joiner: "and",
      placeholder: "families",
      needs: "one or more loaded families from the draft categories",
      multi: true,
      dir: "read",
      liveness: "detached",
    },
  ],
  stages: [
    {
      key: "scope",
      label: "scope",
      verbs: [
        {
          key: "apply-scope",
          label: "apply scope",
          demands: ["category", "family"],
          run: actions.applyScope,
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
          run: actions.plan,
          refuse: actions.refusePlan,
        },
        {
          key: "apply",
          label: "apply",
          demands: ["world", "profile", "category", "family"],
          commit: true,
          run: actions.apply,
          refuse: actions.refuseApply,
        },
      ],
    },
  ],
  panes: [{ key: "matrix", label: "matrix", draws: ["category", "family"] }],
});
