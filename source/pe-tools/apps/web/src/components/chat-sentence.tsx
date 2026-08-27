import { useState } from "react";

import { useChatTarget } from "#/components/chat-target";
import { useFleet } from "#/host/fleet";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingState } from "#/targeting/kit";
import { product } from "#/targeting/model";
import { worldTrunk } from "#/targeting/world";

/** Chat uses the same kit as route heads; the world picker is its only targeting slot. */
export function ChatSentence() {
  const fleet = useFleet();
  const { selector, pin } = useChatTarget();
  const [open, setOpen] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const manifest = product("chat", "target", { world: worldTrunk.link })({
    feeds: { world: worldTrunk.feed(fleet) },
    stages: [{ key: "address", label: "address", verbs: [] }],
    panes: [],
  });
  const state: BindingState<"world"> = {
    bound: { world: selector || null },
    multi: {},
    stage: "address",
  };
  const bindings = useBindings(
    manifest,
    state,
    (patch) => patch.bound?.world !== undefined && pin(patch.bound.world ?? ""),
    open,
    setOpen,
    level,
    setLevel,
    query,
    setQuery,
  );
  const runner = useRunner(manifest, bindings);
  return <TargetingHead mode="line" product={manifest} b={bindings} runner={runner} />;
}
