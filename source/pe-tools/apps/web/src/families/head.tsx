import { useCallback } from "react";
import { useAtomValue } from "@effect/atom-react";

import { FactChip } from "#/components/lang/chip";
import { VerbLane } from "#/components/lang/verb-lane";
import { FAMILIES_PRODUCT, type FamiliesSlot } from "#/families/product";
import type { FamiliesStore } from "#/families/store";
import { useFamiliesWorkspace } from "#/families/workspace-context";
import { useFleet } from "#/host/fleet";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingPatch, type BindingState } from "#/targeting/kit";
import { worldTrunk } from "#/targeting/world";

const same = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export function FamiliesHead({ store }: { store: FamiliesStore }) {
  const target = useAtomValue(store.atoms.target);
  const profilePath = useAtomValue(store.atoms.profilePath);
  const draft = useAtomValue(store.atoms.draft);
  const applied = useAtomValue(store.atoms.applied);
  const plan = useAtomValue(store.atoms.plan);
  const picker = useAtomValue(store.atoms.picker);
  const busy = useAtomValue(store.atoms.busy);
  const fleet = useFleet({ enabled: !useFamiliesWorkspace().fixture });
  const feeds = {
    world: worldTrunk.feed(fleet),
    profile: useAtomValue(store.feeds.profile),
    scope: {
      options: [{ id: "scope", label: "scope" }],
      state: "ready" as const,
      lane: "read" as const,
      stale: false,
    },
    category: useAtomValue(store.feeds.category),
    family: useAtomValue(store.feeds.family),
  };
  const scopeDrifted =
    applied !== null &&
    (!same(applied.categoryNames, draft.categories) ||
      !same(applied.familyNames, draft.families) ||
      applied.placementScope !== draft.placement);
  const product = FAMILIES_PRODUCT(feeds, {
    applyScope: async () => void (await store.actions.applyScope()),
    plan: async () => void (await store.actions.plan()),
    apply: async () => void (await store.actions.applyFoundry()),
    refusePlan: () =>
      applied === null
        ? "apply the draft scope first"
        : scopeDrifted
          ? "the draft changed — re-apply scope first"
          : null,
    refuseApply: () => (plan ? null : "plan first"),
  });
  const state: BindingState<FamiliesSlot> = {
    bound: {
      world: target || null,
      profile: profilePath,
      scope: "scope",
      category: null,
      family: null,
    },
    multi: {
      category: new Set(draft.categories),
      family: new Set(draft.families),
    },
    stage: picker.stage,
  };
  const setState = useCallback(
    (patch: BindingPatch<FamiliesSlot>) => {
      const world = patch.bound?.world;
      const profile = patch.bound?.profile;
      if (world != null && world !== target) void store.actions.bind(world);
      if (profile != null && profile !== profilePath) void store.actions.setProfile(profile);
      if (patch.multi)
        store.actions.setDraft((previous) => ({
          ...previous,
          categories: [...(patch.multi?.category ?? new Set(previous.categories))].sort(),
          families: [...(patch.multi?.family ?? new Set(previous.families))].sort(),
        }));
      if (patch.stage)
        store.actions.setPicker((previous) => ({ ...previous, stage: patch.stage! }));
    },
    [profilePath, store, target],
  );
  const b = useBindings(
    product,
    state,
    setState,
    picker.open,
    (open) => store.actions.setPicker((previous) => ({ ...previous, open })),
    picker.level,
    (level) => store.actions.setPicker((previous) => ({ ...previous, level })),
    picker.query,
    (query) => store.actions.setPicker((previous) => ({ ...previous, query })),
  );
  const runner = useRunner(product, b, busy?.id ?? null);
  return (
    <TargetingHead
      product={product}
      b={b}
      runner={runner}
      aside={
        plan ? (
          <FactChip title="The plan hash that the apply command must return unchanged.">
            plan hash · {plan.planHash.slice(0, 12)}
          </FactChip>
        ) : undefined
      }
      receipt={<VerbLane atoms={store.atoms} />}
    />
  );
}
