import { useCallback } from "react";
import { useAtomValue } from "@effect/atom-react";

import { OutcomeLine } from "#/components/lang/outcome";
import { SETTINGS_PRODUCT } from "#/settings/product";
import type { SettingsStore } from "#/settings/store";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingState } from "#/targeting/kit";

export function SettingsHead({ store, aside }: { store: SettingsStore; aside?: React.ReactNode }) {
  const picker = useAtomValue(store.atoms.picker);
  const targeting = useAtomValue(store.atoms.targeting);
  const binding = useAtomValue(store.atoms.binding);
  const busy = useAtomValue(store.atoms.busy);
  const receipt = useAtomValue(store.atoms.receipt);
  const feeds = {
    workspace: useAtomValue(store.feeds.workspace),
    module: useAtomValue(store.feeds.module),
    root: useAtomValue(store.feeds.root),
    file: useAtomValue(store.feeds.file),
    session: useAtomValue(store.feeds.session),
  };
  const product = SETTINGS_PRODUCT({
    open: store.actions.open,
    refresh: store.actions.refresh,
    validate: store.actions.validate,
    save: store.actions.save,
  });
  const state: BindingState = {
    bound: {
      workspace: picker.workspaceKey ?? null,
      module: picker.moduleKey ?? null,
      root: picker.rootKey ?? null,
      file: picker.filePath ?? null,
      session: binding.target ?? null,
    },
    multi: {},
    stage: "document",
  };
  const setState = useCallback(
    (patch: Partial<BindingState>) => {
      if (patch.bound) {
        store.actions.setPicker({
          workspaceKey: patch.bound.workspace ?? undefined,
          moduleKey: patch.bound.module ?? undefined,
          rootKey: patch.bound.root ?? undefined,
          filePath: patch.bound.file ?? undefined,
        });
        const session = patch.bound.session ?? null;
        if (session !== (binding.target ?? null)) void store.actions.bind(session).catch(() => undefined);
      }
    },
    [binding.target, store],
  );
  const b = useBindings(
    product,
    feeds,
    state,
    setState,
    targeting.open,
    (open) => store.actions.setTargeting((previous) => ({ ...previous, open })),
    targeting.level,
    (level) => store.actions.setTargeting((previous) => ({ ...previous, level })),
    targeting.query,
    (query) => store.actions.setTargeting((previous) => ({ ...previous, query })),
  );
  const runner = useRunner(product, b, busy?.id ?? null);
  return (
    <TargetingHead
      product={product}
      b={b}
      runner={runner}
      receipt={receipt ? <OutcomeLine kind="receipt" label={receipt.text} /> : undefined}
      aside={aside}
    />
  );
}
