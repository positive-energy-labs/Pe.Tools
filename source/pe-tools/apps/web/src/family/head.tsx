import { useCallback } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { FAMILY_PRODUCT } from "#/family/product";
import type { FamilyStore } from "#/family/store";
import { OutcomeLine } from "#/components/lang/outcome";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingState } from "#/targeting/kit";

type Action = () => Promise<unknown> | void;

export function FamilyHead({
  store,
  onOpen,
  onPickSession,
  onSave,
  onCapture,
  onBuild,
  outcome,
  aside,
}: {
  store: FamilyStore;
  onOpen: (profile: string) => Promise<unknown> | void;
  onPickSession: (session: string) => void;
  onSave: Action;
  onCapture: Action;
  onBuild: Action;
  outcome?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const { target = "", profile = "", stage = "author" } = useSearch({ from: "/family" });
  const navigate = useNavigate({ from: "/family" });
  const picker = useAtomValue(store.atoms.picker);
  const busy = useAtomValue(store.atoms.busy);
  const receipt = useAtomValue(store.atoms.receipt);
  const feeds = {
    session: useAtomValue(store.feeds.session),
    profile: useAtomValue(store.feeds.profile),
  };
  const product = FAMILY_PRODUCT({
    open: async () => void (await onOpen(profile)),
    save: async () => void (await onSave()),
    capture: async () => void (await onCapture()),
    build: async () => void (await onBuild()),
  });
  const state: BindingState = {
    bound: { session: target || null, profile: profile || null },
    multi: {},
    stage,
  };
  const setState = useCallback(
    (patch: Partial<BindingState>) => {
      const nextSession = patch.bound?.session ?? null;
      const nextProfile = patch.bound?.profile ?? null;
      if (nextSession !== null && nextSession !== target) onPickSession(nextSession);
      if (nextProfile !== null && nextProfile !== profile)
        void navigate({ search: (previous) => ({ ...previous, profile: nextProfile }) });
      const nextStage = patch.stage === "evidence" ? "evidence" : "author";
      if (patch.stage && nextStage !== stage)
        void navigate({ search: (previous) => ({ ...previous, stage: nextStage }) });
    },
    [navigate, onPickSession, profile, stage, target],
  );
  const b = useBindings(
    product,
    feeds,
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
      receipt={outcome ?? (receipt ? <OutcomeLine kind="receipt" label={receipt.text} /> : undefined)}
      aside={aside}
    />
  );
}
